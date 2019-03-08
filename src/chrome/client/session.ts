/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';

export interface ISession {
    sendEvent(event: DebugProtocol.Event): void;
    shutdown(): void;
    sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void;
    dispatchRequest(request: DebugProtocol.Request): Promise<void>;
}

export abstract class BaseWrappedSession implements ISession {
    constructor(protected readonly _wrappedSession: ISession) { }

    public dispatchRequest(request: DebugProtocol.Request): Promise<void> {
        return this._wrappedSession.dispatchRequest(request);
    }

    public sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {
        this._wrappedSession.sendRequest(command, args, timeout, cb);
    }

    public sendEvent(event: DebugProtocol.Event): void {
        this._wrappedSession.sendEvent(event);
    }

    public shutdown(): void {
        this._wrappedSession.shutdown();
    }
}