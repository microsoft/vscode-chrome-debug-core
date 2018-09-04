import { DebugProtocol } from 'vscode-debugprotocol';
import { InitializedEvent } from 'vscode-debugadapter';
import { WrappedSessionCommonLogic } from './session';

export class DelayMessagesUntilInitializedSession extends WrappedSessionCommonLogic {
    private _hasSentInitializedMessage = false;
    private _eventsWaitingInitialization: DebugProtocol.Event[] = [];

    public sendEvent(event: DebugProtocol.Event): void {
        if (this._hasSentInitializedMessage) {
            super.sendEvent(event);
        } else if (event instanceof InitializedEvent) {
            this._wrappedSession.sendEvent(event);
            this._hasSentInitializedMessage = true;
            this._eventsWaitingInitialization.forEach(storedEvent =>
                this._wrappedSession.sendEvent(storedEvent));
            this._eventsWaitingInitialization = [];
        } else {
            this._eventsWaitingInitialization.push(event);
        }
    }
}