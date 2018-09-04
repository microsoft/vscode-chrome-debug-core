/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { logger } from 'vscode-debugadapter';
import * as WebSocket from 'ws';
import { LikeSocket } from 'noice-json-rpc';

export class WebSocketToLikeSocketProxy {
    private _server: WebSocket.Server;
    private _currentlyOpenedWebSocket: WebSocket = null;

    constructor(private _port: number, private _socket: LikeSocket) { }

    public start(): void {
        this._server = new WebSocket.Server({ port: this._port }, () => {
            logger.log(`CRDP Proxy listening on: ${this._port}`);
        });

        this._socket.on('close', () => {
            logger.log('CRDP Proxy shutting down');
            this._server.close(() => {
                if (this._currentlyOpenedWebSocket !== null) {
                    this._currentlyOpenedWebSocket.close();
                    logger.log('CRDP Proxy succesfully shut down');
                }

                return {};
            });
        });

        this._server.on('connection', openedWebSocket => {
            if (this._currentlyOpenedWebSocket !== null) {
                openedWebSocket.close();
                throw Error(`CRDP Proxy: Only one websocket is supported by the server on port ${this._port}`);
            } else {
                this._currentlyOpenedWebSocket = openedWebSocket;
                logger.log(`CRDP Proxy accepted a new connection`);
            }

            openedWebSocket.on('message', data => {
                logger.log(`CRDP Proxy - Client to Target: ${data}`);
                this._socket.send(data.toString());
            });

            openedWebSocket.on('close', () => {
                logger.log('CRDP Proxy - Client closed the connection');
                this._currentlyOpenedWebSocket = null;
            });

            this._socket.on('message', data => {
                logger.log(`CRDP Proxy - Target to Client: ${data}`);
                openedWebSocket.send(data);
            });
        });
    }
}
