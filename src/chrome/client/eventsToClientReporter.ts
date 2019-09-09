/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from '../internal/sources/loadedSource';
import { ISession } from './session';
import { LoadedSourceEvent, OutputEvent, BreakpointEvent, Source, ContinuedEvent } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { LocationInLoadedSource } from '../internal/locations/location';
import { IBPRecipeStatus } from '../internal/breakpoints/bpRecipeStatus';
import { IFormattedExceptionLineDescription } from '../internal/formattedExceptionParser';
import { StoppedEvent2, ReasonType } from '../stoppedEvent';
import { injectable, inject } from 'inversify';
import { TYPES } from '../dependencyInjection.ts/types';
import { Protocol as CDTP } from 'devtools-protocol';
import { ChromeDebugLogic } from '../chromeDebugAdapter';
import { ExceptionStackTracePrinter } from '../internal/exceptions/exceptionStackTracePrinter';
import { LocationInSourceToClientConverter } from './locationInSourceToClientConverter';
import { HandlesRegistry } from './handlesRegistry';
import { ISourceToClientConverter } from './sourceToClientConverter';
import { BPRecipieStatusToClientConverter } from '../internal/breakpoints/features/bpRecipieStatusToClientConverter';
import { ConnectedCDAConfiguration } from './chromeDebugAdapter/cdaConfiguration';
import { LineColTransformer } from '../../transformers/lineNumberTransformer';
import { isDefined } from '../utils/typedOperators';
import { DoNotLog } from '../logging/decorators';
import { PossiblyCustomerContent } from '../logging/gdpr';
import { Listeners } from '../communication/listeners';

export interface IOutputParameters {
    readonly output: string;
    readonly category: string;
    readonly variablesReference?: number;
    readonly location?: LocationInLoadedSource;
}

interface ICustomerContentOutputParameters {
    readonly output: PossiblyCustomerContent<string>;
    readonly category: string;
}

export interface ISourceWasLoadedParameters {
    readonly reason: 'new' | 'changed' | 'removed';
    readonly source: ILoadedSource;
}

export interface IBPStatusChangedParameters {
    readonly reason: string;
    readonly bpRecipeStatus: IBPRecipeStatus;
}

export interface IExceptionThrownParameters {
    readonly exceptionStackTrace: IFormattedExceptionLineDescription[];
    readonly category: string;
    readonly location: LocationInLoadedSource | undefined;
}

export interface IDebuggeeIsStoppedParameters {
    reason: ReasonType;
    exception?: CDTP.Runtime.RemoteObject;
}

export interface IEventsToClientReporter {
    sendOutput(params: IOutputParameters): void;
    sendCustomerContentOutput(params: ICustomerContentOutputParameters): void;
    sendSourceWasLoaded(params: ISourceWasLoadedParameters): Promise<void>;
    sendBPStatusChanged(params: IBPStatusChangedParameters): Promise<void>;
    sendExceptionThrown(params: IExceptionThrownParameters): Promise<void>;
    sendDebuggeeIsStopped(params: IDebuggeeIsStoppedParameters): Promise<void>;
    sendDebuggeeIsResumed(): Promise<void>;

    // Events provided
    listenToDebuggeeWasStopped(listener: (params: IDebuggeeIsStoppedParameters) => void): void;
    listenToDebuggeeWasResumed(listener: () => void): void;
}

/**
 * This class is used to report events (breakpoint hit, source loaded, etc..) to the client (VS Code or VS).
 * TODO: Eventually we'll probably want to split this class into a set of smaller isolated classes
 */
@injectable()
export class EventsToClientReporter implements IEventsToClientReporter {
    private readonly _exceptionStackTracePrinter = new ExceptionStackTracePrinter(this._configuration);
    private readonly _locationInSourceToClientConverter = new LocationInSourceToClientConverter(this._sourceToClientConverter, this._lineColTransformer);
    private readonly _bpRecipieStatusToClientConverter = new BPRecipieStatusToClientConverter(this._handlesRegistry, this._sourceToClientConverter, this._lineColTransformer);

    // Events provided' listeners
    private readonly _debuggeeWasStoppedListeners = new Listeners<IDebuggeeIsStoppedParameters, void>();
    private readonly _debuggeeWasResumedListeners = new Listeners<void, void>();

    constructor(
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.ISession) private readonly _session: ISession,
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.SourceToClientConverter) private readonly _sourceToClientConverter: ISourceToClientConverter,
        @inject(TYPES.LineColTransformer) private readonly _lineColTransformer: LineColTransformer) { }

        @DoNotLog()
        public async sendOutput(params: IOutputParameters) {
        const event = new OutputEvent(params.output, params.category) as DebugProtocol.OutputEvent;

        if (isDefined(params.variablesReference)) {
            event.body.variablesReference = params.variablesReference;
        }

        if (isDefined(params.location)) {
            await this._locationInSourceToClientConverter.toLocationInSource(params.location, event.body);
        }

        this._session.sendEvent(event);
    }

    @DoNotLog()
    public sendCustomerContentOutput(params: ICustomerContentOutputParameters): void {
        const event = new OutputEvent(params.output.customerContentData, params.category, { doNotLogOutput: true }) as DebugProtocol.OutputEvent;
        this._session.sendEvent(event);
    }

    @DoNotLog()
    public async sendSourceWasLoaded(params: ISourceWasLoadedParameters): Promise<void> {
        const clientSource = await this._sourceToClientConverter.toSource(params.source);
        const event = new LoadedSourceEvent(params.reason, <Source>clientSource); // TODO: Update source to have an optional sourceReference so we don't need to do this cast

        this._session.sendEvent(event);
    }

    @DoNotLog()
    public async sendBPStatusChanged(params: IBPStatusChangedParameters): Promise<void> {
        const breakpointStatus = await this._bpRecipieStatusToClientConverter.toExistingBreakpoint(params.bpRecipeStatus);
        const event = new BreakpointEvent(params.reason, breakpointStatus);

        this._session.sendEvent(event);
    }

    @DoNotLog()
    public async sendExceptionThrown(params: IExceptionThrownParameters): Promise<void> {
        return this.sendOutput({
            output: this._exceptionStackTracePrinter.toStackTraceString(params.exceptionStackTrace),
            category: params.category,
            location: params.location
        });
    }

    @DoNotLog()
    public async sendDebuggeeIsStopped(params: IDebuggeeIsStoppedParameters): Promise<void> {
        this._session.sendEvent(new StoppedEvent2(params.reason, /*threadId=*/ChromeDebugLogic.THREAD_ID, params.exception));
        this._debuggeeWasStoppedListeners.call(params);
    }

    @DoNotLog()
    public async sendDebuggeeIsResumed(): Promise<void> {
        this._session.sendEvent(new ContinuedEvent(ChromeDebugLogic.THREAD_ID));

        this._debuggeeWasResumedListeners.call();
    }

    public listenToDebuggeeWasStopped(listener: (params: IDebuggeeIsStoppedParameters) => void): void {
        this._debuggeeWasStoppedListeners.add(listener);
    }

    public listenToDebuggeeWasResumed(listener: () => void): void {
        this._debuggeeWasResumedListeners.add(listener);
    }
}
