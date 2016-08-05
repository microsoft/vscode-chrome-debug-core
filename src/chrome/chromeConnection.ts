/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as WebSocket from 'ws';
import {EventEmitter} from 'events';

import * as utils from '../utils';
import * as logger from '../logger';

import {Client} from 'noice-json-rpc';
import Crdp from 'chrome-remote-debug-protocol';

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

interface IMessageWithId {
    id: number;
    method: string;
    params?: string[];
}

/**
 * Implements a Request/Response API on top of a WebSocket for messages that are marked with an `id` property.
 * Emits `message.method` for messages that don't have `id`.
 */
class ResReqWebSocket extends EventEmitter {
    private _pendingRequests = new Map<number, any>();
    private _wsAttached: Promise<WebSocket>;

    public get isOpen(): boolean { return !!this._wsAttached; }

    /**
     * Attach to the given websocket url
     */
    public open(wsUrl: string): Promise<void> {
        this._wsAttached = new Promise((resolve, reject) => {
            let ws: WebSocket;
            try {
                ws = new WebSocket(wsUrl);
            } catch (e) {
                // invalid url e.g.
                reject(e.message);
                return;
            }

            // WebSocket will try to connect for 20+ seconds before timing out.
            // Implement a shorter timeout here
            setTimeout(() => reject('WebSocket connection timed out'), 10000);

            // if 'error' is fired while connecting, reject the promise
            ws.on('error', reject);
            ws.on('open', () => {
                // Replace the promise-rejecting handler
                ws.removeListener('error', reject);

                ws.on('error', e => {
                    logger.log('Websocket error: ' + e.toString());
                    this.emit('error', e);
                });

                resolve(ws);
            });
            ws.on('message', msgStr => {
                const msgObj = JSON.parse(msgStr);
                if (msgObj
                    && !(msgObj.method === 'Debugger.scriptParsed' && msgObj.params && msgObj.params.isContentScript)
                    && !(msgObj.params && msgObj.params.url && msgObj.params.url.indexOf('extensions::') === 0)) {
                    // Not really the right place to examine the content of the message, but don't log annoying extension script notifications.
                    logger.verbose('From target: ' + msgStr);
                }

                this.onMessage(msgObj);
            });
            ws.on('close', () => {
                logger.log('Websocket closed');
                this.emit('close');
            });
        });

        return <Promise<void>><any>this._wsAttached;
    }

    public close(): void {
        if (this._wsAttached) {
            this._wsAttached.then(ws => ws.close());
            this._wsAttached = null;
        }
    }

    /**
     * Send a message which must have an id. Ok to call immediately after attach. Messages will be queued until
     * the websocket actually attaches.
     */
    public sendMessage(message: IMessageWithId): Promise<any> {
        return new Promise((resolve, reject) => {
            this._pendingRequests.set(message.id, resolve);
            this._wsAttached.then(ws => {
                const msgStr = JSON.stringify(message);
                logger.verbose('To target: ' + msgStr);
                ws.send(msgStr);
            });
        });
    }

    /**
     * Wrap EventEmitter.emit in try/catch and log, for errors thrown in subscribers
     */
    public emit(event: string, ...args: any[]): boolean {
        try {
            return super.emit.apply(this, arguments);
        } catch (e) {
            logger.error('Error while handling target event: ' + e.stack);
        }
    }

    private onMessage(message: any): void {
        if (typeof message.id === 'number') {
            if (this._pendingRequests.has(message.id)) {
                // Resolve the pending request with this response
                this._pendingRequests.get(message.id)(message);
                this._pendingRequests.delete(message.id);
            } else {
                logger.error(`Got a response with id ${message.id} for which there is no pending request.`);
            }
        } else if (message.method) {
            this.emit(message.method, message.params);
        } else {
            // Message is malformed - safely stringify and log it
            let messageStr: string;
            try {
                messageStr = JSON.stringify(message);
            } catch (e) {
                messageStr = '' + message;
            }

            logger.error(`Got a response with no id nor method property: ${messageStr}`);
        }
    }
}

export type ITargetFilter = (target: ITarget) => boolean;
export type ITargetDiscoveryStrategy = (address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string) => Promise<string>;

/**
 * Connects to a target supporting the Chrome Debug Protocol and sends and receives messages
 */
export class ChromeConnection {
    private _nextId: number;
    private _socket: WebSocket;
    private _client: Client;
    private _targetFilter: ITargetFilter;
    private _targetDiscoveryStrategy: ITargetDiscoveryStrategy;

    constructor(targetDiscovery: ITargetDiscoveryStrategy, targetFilter?: ITargetFilter) {
        this._targetFilter = targetFilter;
        this._targetDiscoveryStrategy = targetDiscovery;

        // this._socket should exist before attaching so consumers can call on() before attach, which fires events
        this.reset();
    }

    public get isAttached(): boolean { return !!this._client; }

    public on(eventName: string, handler: (msg: any) => void): void {
        this._client.on(eventName, handler);
    }

    public get api(): Crdp.CrdpClient {
        return this._client.api();
    }

    /**
     * Attach the websocket to the first available tab in the chrome instance with the given remote debugging port number.
     */
    public attach(address = '127.0.0.1', port = 9222, targetUrl?: string): Promise<void> {
        return utils.retryAsync(() => this._targetDiscoveryStrategy(address, port, this._targetFilter, targetUrl), /*timeoutMs=*/7000, /*intervalDelay=*/200)
            .then(wsUrl => {
                this._socket = new WebSocket(wsUrl);
                this._client = new Client(this._socket);
            });
    }

    public close(): void {
        this._socket.close();
        this.reset();
    }

    private reset(): void {
        this._nextId = 1;
        this._socket = null;
        this._client = null;
    }
}
