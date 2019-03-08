import { PausedEvent, ICDTPDebuggeeExecutionEventsProvider } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { IActionToTakeWhenPaused, NoActionIsNeededForThisPause } from '../features/actionToTakeWhenPaused';
import { ScriptCallFrame } from './callFrame';
import { CodeFlowStackTrace } from './codeFlowStackTrace';
import { ILoadedSource } from '../sources/loadedSource';

/**
 * CDTP doesn't have a way to query for the current stack trace. We use this class to store
 * the latest stack trace that we got in the latest PausedEvent, in case some component needs to access it.
 */
export class CurrentStackTraceProvider {
    private _currentPauseEvent: PausedEvent | null = null; // Each time the debuggee pauses we store the latest PausedEvent in case the stack trace is requested

    public constructor(private readonly _cdtpDebuggeeExecutionEventsProvider: ICDTPDebuggeeExecutionEventsProvider) {
        this._cdtpDebuggeeExecutionEventsProvider.onResumed(() => this.onResumed());
        this._cdtpDebuggeeExecutionEventsProvider.onPaused(params => this.onPaused(params));
    }

    public isPaused(): boolean {
        return this._currentPauseEvent !== null;
    }

    public syncStackFrames(): ScriptCallFrame[] {
        this.validateItIsPaused();

        return this._currentPauseEvent.callFrames;
    }

    public asyncStackTrace(): CodeFlowStackTrace {
        this.validateItIsPaused();

        return this._currentPauseEvent.asyncStackTrace;
    }

    public isSourceInCurrentStack(source: ILoadedSource): boolean {
        this.validateItIsPaused();

        return this.isSourceInCurrentSyncStack(source)
            || this.isSourceInAsyncStack(this.asyncStackTrace(), source);
    }

    private isSourceInCurrentSyncStack(source: ILoadedSource<string>): boolean {
        return this.syncStackFrames().some(frame => frame.mappedToSource().source.isEquivalentTo(source));
    }

    private isSourceInAsyncStack(asyncStackTrace: CodeFlowStackTrace, source: ILoadedSource<string>): boolean {
        return asyncStackTrace.codeFlowFrames.some(frame => frame.location.mappedToSource().source.isEquivalentTo(source))
            || (asyncStackTrace.parent && this.isSourceInAsyncStack(asyncStackTrace.parent, source));
    }

    private validateItIsPaused() {
        if (!this.isPaused()) {
            throw new Error(`Can't obtain current stack strace when the debuggee is not paused`);
        }
    }

    private async onPaused(pausedEvent: PausedEvent): Promise<IActionToTakeWhenPaused> {
        this._currentPauseEvent = pausedEvent;
        return new NoActionIsNeededForThisPause(this);
    }

    private onResumed(): void {
        this._currentPauseEvent = null;
    }
}
