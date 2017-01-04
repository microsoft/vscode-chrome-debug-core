/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as WebSocket from 'ws';

import * as errors from '../errors';
import * as utils from '../utils';
import * as logger from '../logger';
import {getChromeTargetWebSocketURL} from './chromeTargetDiscoveryStrategy';

import {Client} from 'noice-json-rpc';
import Crdp from '../../crdp/crdp';

export interface ITarget {
    description: string;
    devtoolsFrontendUrl: string;
    id: string;
    thumbnailUrl?: string;
    title: string;
    type: string;
    url?: string;
    webSocketDebuggerUrl: string;
}

/**
 * A subclass of WebSocket that logs all traffic
 */
class LoggingSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[], options?: WebSocket.IClientOptions) {
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
                msgObj = JSON.parse(msgStr);
            } catch (e) {
                logger.error(`Invalid JSON from target: (${e.message}): ${msgStr}`);
                return;
            }

            if (msgObj
                && !(msgObj.method === 'Debugger.scriptParsed' && msgObj.params && msgObj.params.isContentScript)
                && !(msgObj.params && msgObj.params.url && msgObj.params.url.indexOf('extensions::') === 0)) {
                // Not really the right place to examine the content of the message, but don't log annoying extension script notifications.
                logger.verbose('From target: ' + msgStr);
            }
        });
    }

    public send(data: any, cb?: (err: Error) => void): void {
        super.send.apply(this, arguments);

        const msgStr = JSON.stringify(data);
        logger.verbose('To target: ' + msgStr);
    }
}

export type ITargetFilter = (target: ITarget) => boolean;
export type ITargetDiscoveryStrategy = (address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string) => Promise<string>;

export interface IChromeError {
    code: number;
    message: string;
    data: string;
}

/**
 * Connects to a target supporting the Chrome Debug Protocol and sends and receives messages
 */
export class ChromeConnection {
    private static ATTACH_TIMEOUT = 10000; // ms

    private _socket: WebSocket;
    private _client: Client;
    private _targetFilter: ITargetFilter;
    private _targetDiscoveryStrategy: ITargetDiscoveryStrategy;

    constructor(targetDiscovery?: ITargetDiscoveryStrategy, targetFilter?: ITargetFilter) {
        this._targetFilter = targetFilter;
        this._targetDiscoveryStrategy = targetDiscovery || getChromeTargetWebSocketURL;
    }

    public get isAttached(): boolean { return !!this._client; }

    public get api(): Crdp.CrdpClient {
        return this._client && this._client.api();
    }

    /**
     * Attach the websocket to the first available tab in the chrome instance with the given remote debugging port number.
     */
    public attach(address = '127.0.0.1', port = 9222, targetUrl?: string): Promise<void> {
        return this._attach(address, port, targetUrl)
            .then(() => { });
    }

    private _attach(address: string, port: number, targetUrl?: string, timeout = ChromeConnection.ATTACH_TIMEOUT): Promise<void> {
        return utils.retryAsync(() => this._targetDiscoveryStrategy(address, port, this._targetFilter, targetUrl), timeout, /*intervalDelay=*/200)
            .catch(err => Promise.reject(errors.runtimeConnectionTimeout(timeout, err.message)))
            .then(wsUrl => {
                this._socket = new LoggingSocket(wsUrl);
                this._client = new Client(this._socket);
                this._client.on('error', e => logger.error('Error handling message from target: ' + e.message));
            });
    }

    public run(): Promise<void> {
        // This is a CDP version difference which will have to be handled more elegantly with others later...
        // For now, we need to send both messages and ignore a failing one.
        return Promise.all([
            this.api.Runtime.runIfWaitingForDebugger(),
            (<any>this.api.Runtime).run()
        ])
        .then(() => { }, e => { });
    }

    public close(): void {
        this._socket.close();
    }

    public onClose(handler: () => void): void {
        this._socket.on('close', handler);
    }
}
