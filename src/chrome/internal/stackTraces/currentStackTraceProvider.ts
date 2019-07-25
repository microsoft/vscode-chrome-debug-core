/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { Protocol as CDTP } from 'devtools-protocol';
import { PausedEvent, ICDTPDebuggeeExecutionEventsProvider } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { IActionToTakeWhenPaused, NoActionIsNeededForThisPause } from '../features/actionToTakeWhenPaused';
import { ScriptCallFrame, CallFrameWithState } from './callFrame';
import { CodeFlowStackTrace } from './codeFlowStackTrace';
import { ILoadedSource } from '../sources/loadedSource';
import { isDefined } from '../../utils/typedOperators';

interface ICurrentStackTraceProviderState {
    ifExceptionWasThrown(exceptionWasThrownAction: (exception: CDTP.Runtime.RemoteObject) => void, noExceptionAction: () => void): void;
    isPaused(): boolean;
    syncStackFrames(): ScriptCallFrame<CallFrameWithState>[];
    asyncStackTrace(): CodeFlowStackTrace | undefined;
    isSourceInCurrentStack(source: ILoadedSource): boolean;
    onPaused(pausedEvent: PausedEvent, changeStateTo: (newState: ICurrentStackTraceProviderState) => void): Promise<IActionToTakeWhenPaused>;
    onResumed(changeStateTo: (newState: ICurrentStackTraceProviderState) => void): void;
}

class CurrentStackTraceProviderWhenPaused implements ICurrentStackTraceProviderState {
    public constructor(private _currentPauseEvent: PausedEvent) { }

    public isPaused(): boolean {
        return true;
    }

    public syncStackFrames(): ScriptCallFrame<CallFrameWithState>[] {
        return this._currentPauseEvent.callFrames;
    }

    public asyncStackTrace(): CodeFlowStackTrace | undefined {
        return this._currentPauseEvent.asyncStackTrace;
    }

    public isSourceInCurrentStack(source: ILoadedSource): boolean {
        const asyncStackTrace = this.asyncStackTrace();
        return this.isSourceInCurrentSyncStack(source)
            || (isDefined(asyncStackTrace) ? this.isSourceInAsyncStack(asyncStackTrace, source) : false);
    }

    private isSourceInCurrentSyncStack(source: ILoadedSource<string>): boolean {
        return this.syncStackFrames().some(frame => frame.mappedToSource().source.isEquivalentTo(source));
    }

    private isSourceInAsyncStack(asyncStackTrace: CodeFlowStackTrace, source: ILoadedSource<string>): boolean {
        return asyncStackTrace.codeFlowFrames.some(frame => {
            const mappedSource = frame.location.mappedToSource();
            return mappedSource.source.isEquivalentTo(source);
        })
            || (isDefined(asyncStackTrace.parent) ? this.isSourceInAsyncStack(asyncStackTrace.parent, source) : false);
    }

    public async onPaused(pausedEvent: PausedEvent): Promise<IActionToTakeWhenPaused> {
        throw new Error(localize('error.stackTraceProvider.unexpectedNewPausedEvent', `It's not expected to receive a new pause event: {0} when the current stack trace provided is already in a paused state due to {1}`, pausedEvent.toString(), this._currentPauseEvent.toString()));
    }

    public onResumed(changeStateTo: (newState: ICurrentStackTraceProviderState) => void): void {
        changeStateTo(new CurrentStackTraceProviderWhenNotPaused());
    }

    public ifExceptionWasThrown(exceptionWasThrownAction: (exception: CDTP.Runtime.RemoteObject) => void, noExceptionAction: () => void): void {
        return this._currentPauseEvent.reason === 'exception'
        ? exceptionWasThrownAction(this._currentPauseEvent.data)
        : noExceptionAction();
    }

    public toString(): string {
        return `Paused on: ${this._currentPauseEvent}`;
    }
}

class CurrentStackTraceProviderWhenNotPaused implements ICurrentStackTraceProviderState {
    public isPaused(): boolean {
        return false;
    }

    public syncStackFrames(): ScriptCallFrame<CallFrameWithState>[] {
        return this.throwItIsNotPaused();
    }

    public asyncStackTrace(): CodeFlowStackTrace {
        return this.throwItIsNotPaused();
    }

    public isSourceInCurrentStack(_source: ILoadedSource<string>): boolean {
        return this.throwItIsNotPaused();
    }

    public async onPaused(pausedEvent: PausedEvent, changeStateTo: (newState: ICurrentStackTraceProviderState) => void): Promise<IActionToTakeWhenPaused> {
        changeStateTo(new CurrentStackTraceProviderWhenPaused(pausedEvent));
        return new NoActionIsNeededForThisPause(this);
    }

    public onResumed(_changeStateTo: (newState: ICurrentStackTraceProviderState) => void): void {
        return this.throwItIsNotPaused();
    }

    public ifExceptionWasThrown(_exceptionWasThrownAction: (exception: CDTP.Runtime.RemoteObject) => void, _noExceptionAction: () => void): void {
        return this.throwItIsNotPaused();
    }

    private throwItIsNotPaused(): never {
        throw new Error(localize('error.stackTraceProvider.notPaused', `Can't obtain current stack strace when the debuggee is not paused`));
    }
}

/**
 * CDTP doesn't have a way to query for the current stack trace. We use this class to store
 * the latest stack trace that we got in the latest PausedEvent, in case some component needs to access it.
 */
export class CurrentStackTraceProvider {
    private _state: ICurrentStackTraceProviderState = new CurrentStackTraceProviderWhenNotPaused(); // Each time the debuggee pauses we store the latest PausedEvent in case the stack trace is requested

    public constructor(private readonly _cdtpDebuggeeExecutionEventsProvider: ICDTPDebuggeeExecutionEventsProvider) {
        this._cdtpDebuggeeExecutionEventsProvider.onResumed(() => this.onResumed());
        this._cdtpDebuggeeExecutionEventsProvider.onPaused(params => this.onPaused(params));
    }

    public isPaused(): boolean {
        return this._state.isPaused();
    }

    public syncStackFrames(): ScriptCallFrame<CallFrameWithState>[] {
        return this._state.syncStackFrames();
    }

    public asyncStackTrace(): CodeFlowStackTrace | undefined {
        return this._state.asyncStackTrace();
    }

    public isSourceInCurrentStack(source: ILoadedSource): boolean {
        return this._state.isSourceInCurrentStack(source);
    }

    public ifExceptionWasThrown(exceptionWasThrownAction: (exception: CDTP.Runtime.RemoteObject) => void, noExceptionAction: () => void): void {
        return this._state.ifExceptionWasThrown(exceptionWasThrownAction, noExceptionAction);
    }

    private onPaused(pausedEvent: PausedEvent): Promise<IActionToTakeWhenPaused> {
        return this._state.onPaused(pausedEvent, state => this._state = state);
    }

    private onResumed(): void {
        return this._state.onResumed(state => this._state = state);
    }
}
