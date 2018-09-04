import { WrappedSessionCommonLogic } from './session';
import { DebugProtocol } from 'vscode-debugprotocol';
import { utils } from '../..';

const steppingRequests = {
    continue: true,
    next: true,
    stepIn: true,
    stepOut: true,
    pause: true,
    restartFrame: true,
};

export class DoNotPauseWhileSteppingSession extends WrappedSessionCommonLogic {
    private readonly _onFlightSteppingRequests = new Set<Promise<void>>();

    public async dispatchRequest(request: DebugProtocol.Request): Promise<void> {
        const response = this._wrappedSession.dispatchRequest(request);
        if (this.isSteppingRequest(request)) {
            // We track the on-flight stepping requests
            this._onFlightSteppingRequests.add(response);
            const finallyHandler = () => { this._onFlightSteppingRequests.delete(response); };
            return response.then(finallyHandler, finallyHandler);
        } else {
            return await response;
        }
    }

    public async sendEvent(event: DebugProtocol.Event): Promise<void> {
        if (event.event === 'stopped') {
            // If this is a stopped event, we try to wait until there are no stepping requests in flight, or we timeout
            await utils.promiseTimeout(this.waitUntilThereAreNoOnFlightSteppingRequests(), /*timeoutMs=*/300);
        }

        this._wrappedSession.sendEvent(event);
    }

    private isSteppingRequest(request: DebugProtocol.Request): boolean {
        return !!(steppingRequests as any)[request.command];
    }

    private async waitUntilThereAreNoOnFlightSteppingRequests(): Promise<void> {
        while (this._onFlightSteppingRequests.size > 0) {
            const onFlightRequests = Array.from(this._onFlightSteppingRequests.keys());
            const noFailOnFlightRequests = onFlightRequests.map(promise => promise.catch(_ => { }));
            await Promise.all(noFailOnFlightRequests);
            // After we waited for all the on flight requests, a new request might just have appeared, so we check and wait again if needed
        }
    }
}