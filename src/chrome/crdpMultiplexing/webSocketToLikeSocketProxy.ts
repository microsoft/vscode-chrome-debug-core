/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { logger } from 'vscode-debugadapter';
import * as WebSocket from 'ws';
import { LikeSocket } from 'noice-json-rpc';

export class WebSocketToLikeSocketProxy {
    private _server: WebSocket.Server;

    constructor(private _port: number, private _socket: LikeSocket) { }

    public start(): void {
        this._server = new WebSocket.Server({ port: this._port }, () => {
            logger.log(`CRDP Proxy listening on: ${this._port}`);
        });

        this._server.on('connection', openedWebSocket => {
            logger.log(`CRDP Proxy accepted a new connection`);
            openedWebSocket.on('message', data => {
                logger.log(`CRDP Proxy - Client to Target: ${data}`);
                this._socket.send(data);
            });

            this._socket.on('message', data => {
                logger.log(`CRDP Proxy - Target to Client: ${data}`);
                openedWebSocket.send(data);
            });
        });
    }
}
