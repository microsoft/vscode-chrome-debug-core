import { ILoadedSource } from '../internal/sources/loadedSource';
import { ISession } from './session';
import { LoadedSourceEvent, OutputEvent, BreakpointEvent } from 'vscode-debugadapter';
import { InternalToClient } from './internalToClient';
import { DebugProtocol } from 'vscode-debugprotocol';
import { LocationInLoadedSource } from '../internal/locations/location';
import { IBPRecipieStatus } from '../internal/breakpoints/bpRecipieStatus';
import { IFormattedExceptionLineDescription } from '../internal/formattedExceptionParser';
import { StoppedEvent2, ReasonType } from '../stoppedEvent';
import { Crdp, ChromeDebugLogic } from '../..';
import { injectable } from 'inversify';

export interface OutputParameters {
    readonly output: NonNullable<string>;
    readonly category: NonNullable<string>;
    readonly variablesReference?: number;
    readonly location?: LocationInLoadedSource;
}

export interface SourceWasLoadedParameters {
    readonly reason: 'new' | 'changed' | 'removed';
    readonly source: ILoadedSource;
}

export interface BPStatusChangedParameters {
    readonly reason: string;
    readonly bpRecipieStatus: IBPRecipieStatus;
}

export interface ExceptionThrownParameters {
    readonly exceptionStackTrace: IFormattedExceptionLineDescription[];
    readonly category: string;
    readonly location?: LocationInLoadedSource;
}

export interface DebugeeIsStoppedParameters {
    reason: ReasonType;
    exception?: Crdp.Runtime.RemoteObject;
}

export interface IEventsToClientReporter {
    sendOutput(params: OutputParameters): void;
    sendSourceWasLoaded(params: SourceWasLoadedParameters): Promise<void>;
    sendBPStatusChanged(params: BPStatusChangedParameters): Promise<void>;
    sendExceptionThrown(params: ExceptionThrownParameters): Promise<void>;
    sendDebugeeIsStopped(params: DebugeeIsStoppedParameters): Promise<void>;
}

@injectable()
export class EventSender implements IEventsToClientReporter {
    public sendOutput(params: OutputParameters): void {
        const event = new OutputEvent(params.output, params.category) as DebugProtocol.OutputEvent;

        if (params.variablesReference) {
            event.body.variablesReference = params.variablesReference;
        }

        if (params.location) {
            this._internalToClient.toLocationInSource(params.location, event.body);
        }

        this._session.sendEvent(event);
    }

    public async sendSourceWasLoaded(params: SourceWasLoadedParameters): Promise<void> {
        // TODO DIEGO: Should we be using the source tree instead of the source here?
        const clientSource = await this._internalToClient.toSource(params.source);
        const event = new LoadedSourceEvent(params.reason, clientSource);

        this._session.sendEvent(event);
    }

    public async sendBPStatusChanged(params: BPStatusChangedParameters): Promise<void> {
        const breakpointStatus = await this._internalToClient.toBPRecipieStatus(params.bpRecipieStatus);
        const event = new BreakpointEvent(params.reason, breakpointStatus);

        this._session.sendEvent(event);
    }

    public async sendExceptionThrown(params: ExceptionThrownParameters): Promise<void> {
        return this.sendOutput({
            output: this._internalToClient.toExceptionStackTracePrintted(params.exceptionStackTrace),
            category: params.category,
            location: params.location
        });
    }

    public async sendDebugeeIsStopped(params: DebugeeIsStoppedParameters): Promise<void> {
        return this._session.sendEvent(new StoppedEvent2(params.reason, /*threadId=*/ChromeDebugLogic.THREAD_ID, params.exception));
    }

    constructor(private readonly _session: ISession, private readonly _internalToClient: InternalToClient) { }
}
