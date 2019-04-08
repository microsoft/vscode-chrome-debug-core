/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as WebSocket from 'ws';

import { StepProgressEventsEmitter, IObservableEvents, IStepStartedEventsEmitter } from '../executionTimingsReporter';
import * as errors from '../errors';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';
import { TargetVersions } from './chromeTargetDiscoveryStrategy';
import { Version } from './utils/version';

import { Client } from 'noice-json-rpc';

import { Protocol as CDTP } from 'devtools-protocol';
import { TYPES } from './dependencyInjection.ts/types';
import { inject, injectable } from 'inversify';
import { ConnectedCDAConfiguration } from './client/chromeDebugAdapter/cdaConfiguration';

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

    public send(data: any, _opts?: any, cb?: (err: Error) => void): void {
        const msgStr = JSON.stringify(data);
        if (this.readyState !== WebSocket.OPEN) {
            logger.log(`→ Warning: Target not open! Message: ${msgStr}`);
            return;
        }

        super.send(data, _opts, cb);
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
@injectable()
export class ChromeConnection implements IObservableEvents<IStepStartedEventsEmitter> {
    private static ATTACH_TIMEOUT = 10000; // ms

    private _socket: WebSocket | null = null;
    private _client?: Client;
    private _targetFilter: ITargetFilter | undefined;
    private _targetDiscoveryStrategy: ITargetDiscoveryStrategy & IObservableEvents<IStepStartedEventsEmitter>;
    private _attachedTarget: ITarget | undefined = undefined;
    public readonly events: StepProgressEventsEmitter;

    constructor(@inject(TYPES.ChromeTargetDiscovery) targetDiscovery: ITargetDiscoveryStrategy & IObservableEvents<IStepStartedEventsEmitter>,
        @inject(TYPES.ConnectedCDAConfiguration) configuration: ConnectedCDAConfiguration) {
        this._targetFilter = configuration.extensibilityPoints.targetFilter;
        this._targetDiscoveryStrategy = targetDiscovery;
        this.events = new StepProgressEventsEmitter([this._targetDiscoveryStrategy.events]);
    }

    public get isAttached(): boolean { return !!this._client; }

    public get api(): CDTP.ProtocolApi {
        return this._client && this._client.api();
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

    public attachToWebsocketUrl(wsUrl: string, _extraCRDPChannelPort?: number): void {
        /* __GDPR__FRAGMENT__
           "StepNames" : {
              "Attach.AttachToTargetDebuggerWebsocket" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
           }
         */
        this.events.emitStepStarted('Attach.AttachToTargetDebuggerWebsocket');
        this._socket = new LoggingSocket(wsUrl, undefined, { headers: { Host: 'localhost' }});
        this._client = new Client(<WebSocket>this._socket as any);

        this._client.on('error', (e: any) => logger.error('Error handling message from target: ' + e.message));
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

    public close(): void {
        this.validateConnectionIsOpen();
        this._socket!.close();
        this._socket = null;
    }

    public onClose(handler: () => void): void {
        this.validateConnectionIsOpen();
        this._socket!.on('close', handler);
    }

    public get version(): Promise<TargetVersions> {
        if (this._attachedTarget) {
            return this._attachedTarget.version
            .then(version => {
                return (version) ? version : new TargetVersions(Version.unknownVersion(), Version.unknownVersion());
            });
        } else {
            throw new Error(`Can't request the version before we are attached to a target`);
        }
    }

    private validateConnectionIsOpen(): void {
        if (this._socket === null) {
            throw new Error(`Can't perform this operation on a connection that is not opened`);
        }
    }
}