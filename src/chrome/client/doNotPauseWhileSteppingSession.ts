/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as utils from '../../utils';
import { BaseWrappedSession } from './session';
import { DebugProtocol } from 'vscode-debugprotocol';

const steppingRequests = {
    continue: true,
    next: true,
    stepIn: true,
    stepOut: true,
    pause: true,
    restartFrame: true,
};

export class DoNotPauseWhileSteppingSession extends BaseWrappedSession {
    private readonly _inFlightSteppingRequests = new Set<Promise<void>>();

    public async dispatchRequest(request: DebugProtocol.Request): Promise<void> {
        const response = this._wrappedSession.dispatchRequest(request);
        if (this.isSteppingRequest(request)) {
            // We track the on-flight stepping requests
            this._inFlightSteppingRequests.add(response);
            const finallyHandler = () => { this._inFlightSteppingRequests.delete(response); };
            return response.then(finallyHandler, finallyHandler);
        } else {
            return await response;
        }
    }

    public async sendEvent(event: DebugProtocol.Event): Promise<void> {
        if (event.event === 'stopped') {
            // If this is a stopped event, we try to wait until there are no stepping requests in flight, or we timeout
            await utils.promiseTimeout(this.waitUntilThereAreNoInFlightSteppingRequests(), /*timeoutMs=*/300);
        }

        this._wrappedSession.sendEvent(event);
    }

    private isSteppingRequest(request: DebugProtocol.Request): boolean {
        return !!(steppingRequests as any)[request.command];
    }

    private async waitUntilThereAreNoInFlightSteppingRequests(): Promise<void> {
        while (this._inFlightSteppingRequests.size > 0) {
            const inFlightRequests = Array.from(this._inFlightSteppingRequests.keys());
            const noFailInFlightRequests = inFlightRequests.map(promise => promise.catch(_ => { }));
            await Promise.all(noFailInFlightRequests);
            // After we waited for all the on flight requests, a new request might just have appeared, so we check and wait again if needed
        }
    }
}