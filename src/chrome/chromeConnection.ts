/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as WebSocket from 'ws';

import { telemetry } from '../telemetry';
import { StepProgressEventsEmitter, IObservableEvents, IStepStartedEventsEmitter } from '../executionTimingsReporter';
import * as errors from '../errors';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';
import { ChromeTargetDiscovery, TargetVersions, Version } from './chromeTargetDiscoveryStrategy';

import { Client, LikeSocket } from 'noice-json-rpc';

import { Protocol as Crdp } from 'devtools-protocol';

import { CRDPMultiplexor } from './crdpMultiplexing/crdpMultiplexor';
import { WebSocketToLikeSocketProxy } from './crdpMultiplexing/webSocketToLikeSocketProxy';

export interface ITarget {
    description: string;
    devtoolsFrontendUrl: string;
    id: string;
    thumbnailUrl?: string;
    title: string;
    type: string;
    url?: string;
    webSocketDebuggerUrl: string;
    version: Promise<TargetVersions>;
}

export type ITargetFilter = (target: ITarget) => boolean;
export interface ITargetDiscoveryStrategy {
    getTarget(address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<ITarget>;
    getAllTargets(address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<ITarget[]>;
}

/**
 * A subclass of WebSocket that logs all traffic
 */
class LoggingSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[], options?: WebSocket.ClientOptions) {
        super(address, protocols, options);

        this.on('error', e => {
            logger.log('Websocket error: ' + e.toString());
        });

        this.on('close', () => {
            logger.log('Websocket closed');
        });

        this.on('message', msgStr => {
            let msgObj: any;
            try {
                msgObj = JSON.parse(msgStr.toString());
            } catch (e) {
                logger.error(`Invalid JSON from target: (${e.message}): ${msgStr}`);
                return;
            }

            if (msgObj && !(msgObj.method && msgObj.method.startsWith('Network.'))) {
                // Not really the right place to examine the content of the message, but don't log annoying Network activity notifications.
                if ((msgObj.result && msgObj.result.scriptSource)) {
                    // If this message contains the source of a script, we log everything but the source
                    msgObj.result.scriptSource = '<removed script source for logs>';
                    logger.verbose('← From target: ' + JSON.stringify(msgObj));
                } else {
                    logger.verbose('← From target: ' + msgStr);
                }
            }
        });
    }

    public send(data: any, opts?: any, cb?: (err: Error) => void): void {
        const msgStr = JSON.stringify(data);
        if (this.readyState !== WebSocket.OPEN) {
            logger.log(`→ Warning: Target not open! Message: ${msgStr}`);
            return;
        }

        super.send.apply(this, arguments);
        logger.verbose('→ To target: ' + msgStr);
    }
}

export interface IChromeError {
    code: number;
    message: string;
    data: string;
}

/**
 * Connects to a target supporting the Chrome Debug Protocol and sends and receives messages
 */
export class ChromeConnection implements IObservableEvents<IStepStartedEventsEmitter> {
    protected static ATTACH_TIMEOUT = 10000; // ms

    private _socket: WebSocket;
    private _crdpSocketMultiplexor: CRDPMultiplexor;
    private _client: Client;
    private _targetFilter: ITargetFilter;
    private _targetDiscoveryStrategy: ITargetDiscoveryStrategy & IObservableEvents<IStepStartedEventsEmitter>;
    private _attachedTarget: ITarget;
    public readonly events: StepProgressEventsEmitter;

    constructor(targetDiscovery?: ITargetDiscoveryStrategy & IObservableEvents<IStepStartedEventsEmitter>, targetFilter?: ITargetFilter) {
        this._targetFilter = targetFilter;
        this._targetDiscoveryStrategy = targetDiscovery || new ChromeTargetDiscovery(logger, telemetry);
        this.events = new StepProgressEventsEmitter([this._targetDiscoveryStrategy.events]);
    }

    public get isAttached(): boolean { return !!this._client; }

    public get api(): Crdp.ProtocolApi {
        return this._client && this._client.api();
    }

    public get attachedTarget(): ITarget {
        return this._attachedTarget;
    }

    public setTargetFilter(targetFilter?: ITargetFilter) {
        this._targetFilter = targetFilter;
    }

    /**
     * Attach the websocket to the first available tab in the chrome instance with the given remote debugging port number.
     */
    public attach(address = '127.0.0.1', port = 9222, targetUrl?: string, timeout?: number, extraCRDPChannelPort?: number): Promise<void> {
        return this._attach(address, port, targetUrl, timeout, extraCRDPChannelPort)
            .then(() => { });
    }

    public attachToWebsocketUrl(wsUrl: string, extraCRDPChannelPort?: number): void {
        /* __GDPR__FRAGMENT__
           "StepNames" : {
              "Attach.AttachToTargetDebuggerWebsocket" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
           }
         */
        this.events.emitStepStarted('Attach.AttachToTargetDebuggerWebsocket');
        this._socket = new LoggingSocket(wsUrl, undefined, { headers: { Host: 'localhost' }});
        if (extraCRDPChannelPort) {
            this._crdpSocketMultiplexor = new CRDPMultiplexor(this._socket as any as LikeSocket);
            new WebSocketToLikeSocketProxy(extraCRDPChannelPort, this._crdpSocketMultiplexor.addChannel('extraCRDPEndpoint')).start();
            this._client = new Client(this._crdpSocketMultiplexor.addChannel('debugger'));
        } else {
            this._client = new Client(<WebSocket>this._socket as any);
        }

        this._client.on('error', e => logger.error('Error handling message from target: ' + e.message));
    }

    public getAllTargets(address = '127.0.0.1', port = 9222, targetFilter?: ITargetFilter, targetUrl?: string): Promise<ITarget[]> {
        return this._targetDiscoveryStrategy.getAllTargets(address, port, targetFilter, targetUrl);
    }

    private _attach(address: string, port: number, targetUrl?: string, timeout = ChromeConnection.ATTACH_TIMEOUT, extraCRDPChannelPort?: number): Promise<void> {
        let selectedTarget: ITarget;
        return utils.retryAsync(() => this._targetDiscoveryStrategy.getTarget(address, port, this._targetFilter, targetUrl), timeout, /*intervalDelay=*/200)
            .catch(err => Promise.reject(errors.runtimeConnectionTimeout(timeout, err.message)))
            .then(target => {
                selectedTarget = target;
                return this.attachToWebsocketUrl(target.webSocketDebuggerUrl, extraCRDPChannelPort);
            }).then(() => {
                this._attachedTarget = selectedTarget;
            });
    }

    public run(): Promise<void> {
        // This is a CDP version difference which will have to be handled more elegantly with others later...
        // For now, we need to send both messages and ignore a failing one.
        return Promise.all([
            this.api.Runtime.runIfWaitingForDebugger(),
            (<any>this.api.Runtime).run()
        ])
        .then(() => { }, () => { });
    }

    public close(): void {
        this._socket.close();
    }

    public onClose(handler: () => void): void {
        this._socket.on('close', handler);
    }

    public get version(): Promise<TargetVersions> {
        return this._attachedTarget.version
            .then(version => {
                return (version) ? version : new TargetVersions(Version.unknownVersion(), Version.unknownVersion());
            });
    }
}