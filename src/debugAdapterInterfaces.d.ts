/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/**
 * This file contains extended forms of interfaces from vscode-debugprotocol
 */

import { DebugProtocol } from 'vscode-debugprotocol';
import { Protocol as Crdp } from 'devtools-protocol';
import { ITelemetryPropertyCollector } from './telemetry';
import { IStringDictionary } from './utils';
import { ITargetFilter } from './chrome/chromeConnection';

export type ISourceMapPathOverrides = IStringDictionary<string>;
export type IPathMapping = IStringDictionary<string>;

export type BreakOnLoadStrategy = 'regex' | 'instrument' | 'off';

export { ITelemetryPropertyCollector } from './telemetry';
/**
 * Properties valid for both Launch and Attach
 */
export interface ICommonRequestArgs {
    remoteRoot?: string;
    localRoot?: string;
    pathMapping?: IPathMapping;
    outDir?: string;
    outFiles?: string[];
    sourceMaps?: boolean;
    trace?: boolean|string;
    logFilePath?: string;
    logTimestamps?: boolean;
    sourceMapPathOverrides?: ISourceMapPathOverrides;
    smartStep?: boolean;
    skipFiles?: string[]; // an array of file names or glob patterns
    skipFileRegExps?: string[]; // a supplemental array of library code regex patterns
    timeout?: number;
    showAsyncStacks?: boolean;
    targetFilter?: ITargetFilter;
    enableSourceMapCaching?: boolean;

    /** Private undocumented property to multiplex the CRDP connection into an additional channel */
    extraCRDPChannelPort?: number;

    /** Private undocumented property for enabling break on load */
    breakOnLoadStrategy?: BreakOnLoadStrategy;

    /** Inserted by chrome-debug when debugging from the ui side of a remote window */
    remoteAuthority?: string;

    _suppressConsoleOutput?: boolean;
}

export interface IInitializeRequestArgs extends DebugProtocol.InitializeRequestArguments {
    supportsMapURLToFilePathRequest?: boolean;
}

export interface IRestartRequestArgs {
    port: number;
}

/**
 * Properties needed by -core, just a subset of the properties needed for launch in general
 */
export interface ILaunchRequestArgs extends DebugProtocol.LaunchRequestArguments, ICommonRequestArgs {
    __restart?: IRestartRequestArgs;
}

export interface IAttachRequestArgs extends DebugProtocol.AttachRequestArguments, ICommonRequestArgs {
    port: number;
    url?: string;
    address?: string;

    /** Private undocumented property to attach directly to a known websocket url */
    websocketUrl?: string;
}

export interface IToggleSkipFileStatusArgs {
    path?: string;
    sourceReference?: number;
}

export interface ISetBreakpointsArgs extends DebugProtocol.SetBreakpointsArguments {
    authoredPath?: string;
}

export type ISetBreakpointsResponseBody = DebugProtocol.SetBreakpointsResponse['body'];

/**
 * Internal clone of the crdp version optional fields. If a created BP is in the same location as an existing BP,
 * actualLocation is set so BP can be displayed correctly, but breakpointId is not set.
 *
 * If a breakpoint is set but Chrome returns no locations, actualLocation is not set.
 */
export interface ISetBreakpointResult {
    breakpointId?: Crdp.Debugger.BreakpointId;
    actualLocation?: Crdp.Debugger.Location;
}

export type ISourceResponseBody = DebugProtocol.SourceResponse['body'];

export type IThreadsResponseBody = DebugProtocol.ThreadsResponse['body'];

export type IStackTraceResponseBody = DebugProtocol.StackTraceResponse['body'];

export interface IInternalStackTraceResponseBody extends IStackTraceResponseBody {
    stackFrames: IInternalStackFrame[];
}

export interface IInternalStackFrame extends DebugProtocol.StackFrame {
    isSourceMapped?: boolean;
}

export type IScopesResponseBody = DebugProtocol.ScopesResponse['body'];

export type IVariablesResponseBody = DebugProtocol.VariablesResponse['body'];

export type IEvaluateResponseBody = DebugProtocol.EvaluateResponse['body'];

export type ISetVariableResponseBody = DebugProtocol.SetVariableResponse['body'];

export type ICompletionsResponseBody = DebugProtocol.CompletionsResponse['body'];

export type IGetLoadedSourcesResponseBody = DebugProtocol.LoadedSourcesResponse['body'];

export interface IExceptionDetailsVS extends DebugProtocol.ExceptionDetails {
    /** A VS-specific property */
    formattedDescription?: string;
}

type DAPExceptionInfoResponseBody = DebugProtocol.ExceptionInfoResponse['body'];
export interface IExceptionInfoResponseBody extends DAPExceptionInfoResponseBody {
    details?: IExceptionDetailsVS;
}

export declare type PromiseOrNot<T> = T | Promise<T>;

export interface TimeTravelClient {
    stepBack(): Promise<any>;
    reverse(): Promise<any>;
}

export interface TimeTravelRuntime extends Crdp.ProtocolApi {
    TimeTravel: TimeTravelClient;
}

/**
 * All methods returning PromiseOrNot can either return a Promise or a value, and if they reject the Promise, it can be with an Error or a
 * DebugProtocol.Message object, which will be sent to sendErrorResponse.
 */
export interface IDebugAdapter {
    // From DebugSession
    shutdown(): void;

    initialize(args: DebugProtocol.InitializeRequestArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<DebugProtocol.Capabilities>;
    launch(args: ILaunchRequestArgs, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<void>;
    attach(args: IAttachRequestArgs, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<void>;
    disconnect(args: DebugProtocol.DisconnectArguments): PromiseOrNot<void>;
    setBreakpoints(args: DebugProtocol.SetBreakpointsArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<ISetBreakpointsResponseBody>;
    setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<void>;
    configurationDone(): PromiseOrNot<void>;

    continue(): PromiseOrNot<void>;
    next(): PromiseOrNot<void>;
    stepIn(): PromiseOrNot<void>;
    stepOut(): PromiseOrNot<void>;
    pause(): PromiseOrNot<void>;

    stackTrace(args: DebugProtocol.StackTraceArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<IStackTraceResponseBody>;
    scopes(args: DebugProtocol.ScopesArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<IScopesResponseBody>;
    variables(args: DebugProtocol.VariablesArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<IVariablesResponseBody>;
    source(args: DebugProtocol.SourceArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<ISourceResponseBody>;
    threads(): PromiseOrNot<IThreadsResponseBody>;
    evaluate(args: DebugProtocol.EvaluateArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): PromiseOrNot<IEvaluateResponseBody>;
}

export interface IDebugTransformer {
    initialize?(args: DebugProtocol.InitializeRequestArguments, requestSeq?: number): PromiseOrNot<void>;
    launch?(args: ILaunchRequestArgs, requestSeq?: number): PromiseOrNot<void>;
    attach?(args: IAttachRequestArgs, requestSeq?: number): PromiseOrNot<void>;
    setBreakpoints?(args: DebugProtocol.SetBreakpointsArguments, requestSeq?: number): PromiseOrNot<DebugProtocol.SetBreakpointsArguments>;
    setExceptionBreakpoints?(args: DebugProtocol.SetExceptionBreakpointsArguments, requestSeq?: number): PromiseOrNot<void>;

    stackTrace?(args: DebugProtocol.StackTraceArguments, requestSeq?: number): PromiseOrNot<void>;
    scopes?(args: DebugProtocol.ScopesArguments, requestSeq?: number): PromiseOrNot<void>;
    variables?(args: DebugProtocol.VariablesArguments, requestSeq?: number): PromiseOrNot<void>;
    source?(args: DebugProtocol.SourceArguments, requestSeq?: number): PromiseOrNot<void>;
    evaluate?(args: DebugProtocol.EvaluateArguments, requestSeq?: number): PromiseOrNot<void>;

    setBreakpointsResponse?(response: ISetBreakpointsResponseBody, requestSeq?: number): PromiseOrNot<void>;
    stackTraceResponse?(response: IStackTraceResponseBody, requestSeq?: number): PromiseOrNot<void>;
    scopesResponse?(response: IScopesResponseBody, requestSeq?: number): PromiseOrNot<void>;
    variablesResponse?(response: IVariablesResponseBody, requestSeq?: number): PromiseOrNot<void>;
    sourceResponse?(response: ISourceResponseBody, requestSeq?: number): PromiseOrNot<void>;
    threadsResponse?(response: IThreadsResponseBody, requestSeq?: number): PromiseOrNot<void>;
    evaluateResponse?(response: IEvaluateResponseBody, requestSeq?: number): PromiseOrNot<void>;

    scriptParsed?(event: DebugProtocol.Event): any;
}
