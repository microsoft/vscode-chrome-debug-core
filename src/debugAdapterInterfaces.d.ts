/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/**
 * This file contains extended forms of interfaces from vscode-debugprotocol
 */

import {DebugProtocol} from 'vscode-debugprotocol';
import Crdp from '../crdp/crdp';

export type ISourceMapPathOverrides = { [pattern: string]: string };

/**
 * Properties valid for both Launch and Attach
 */
export interface ICommonRequestArgs {
    webRoot?: string;
    remoteRoot?: string;
    localRoot?: string;
    pathMapping?: {[url: string]: string};
    outDir?: string;
    outFiles?: string[];
    sourceMaps?: boolean;
    diagnosticLogging?: boolean;
    verboseDiagnosticLogging?: boolean;
    trace?: boolean|string;
    sourceMapPathOverrides?: ISourceMapPathOverrides;
    smartStep?: boolean;
    skipFiles?: string[]; // an array of file names or glob patterns
    skipFileRegExps?: string[]; // a supplemental array of library code regex patterns
    timeout?: number;
    showAsyncStacks?: boolean;

    /** Private undocumented property to multiplex the CRDP connection into an additional channel */
    extraCRDPChannelPort?: number;
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

/*
 * The ResponseBody interfaces are copied from debugProtocol.d.ts which defines these inline in the Response interfaces.
 * They should always match those interfaces, see the original for comments.
 */
export interface ISetBreakpointsResponseBody {
    breakpoints: DebugProtocol.Breakpoint[];
}

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

export interface ISourceResponseBody {
    content: string;
    mimeType?: string;
}

export interface IThreadsResponseBody {
    threads: DebugProtocol.Thread[];
}

export interface IStackTraceResponseBody {
    stackFrames: DebugProtocol.StackFrame[];
    totalFrames?: number;
}

export interface IInternalStackFrame extends DebugProtocol.StackFrame {
    isSourceMapped?: boolean;
}

export interface IInternalStackTraceResponseBody extends IStackTraceResponseBody {
    stackFrames: IInternalStackFrame[];
}

export interface IScopesResponseBody {
    scopes: DebugProtocol.Scope[];
}

export interface IVariablesResponseBody {
    variables: DebugProtocol.Variable[];
}

export interface IEvaluateResponseBody {
    result: string;
    type?: string;
    variablesReference: number;
    namedVariables?: number;
    indexedVariables?: number;
}

export interface ISetVariableResponseBody {
    value: string;
}

export interface ICompletionsResponseBody {
    /** The possible completions for . */
    targets: DebugProtocol.CompletionItem[];
}

export interface IGetLoadedSourcesResponseBody {
    sources: DebugProtocol.Source[];
}

export interface IExceptionDetailsVS extends DebugProtocol.ExceptionDetails {
    /** A VS-specific property */
    formattedDescription?: string;
}

export interface IExceptionInfoResponseBody {
    /** ID of the exception that was thrown. */
    exceptionId: string;
    /** Descriptive text for the exception provided by the debug adapter. */
    description?: string;
    /** Mode that caused the exception notification to be raised. */
    breakMode: DebugProtocol.ExceptionBreakMode;
    /** Detailed information about the exception. */
    details?: IExceptionDetailsVS;
}

declare type PromiseOrNot<T> = T | Promise<T>;

export interface TimeTravelClient {
    stepBack(): Promise<any>;
    reverse(): Promise<any>;
}

export interface TimeTravelRuntime extends Crdp.CrdpClient {
    TimeTravel: TimeTravelClient;
}

/**
 * All methods returning PromiseOrNot can either return a Promise or a value, and if they reject the Promise, it can be with an Error or a
 * DebugProtocol.Message object, which will be sent to sendErrorResponse.
 */
export interface IDebugAdapter {
    // From DebugSession
    shutdown(): void;

    initialize(args: DebugProtocol.InitializeRequestArguments, requestSeq?: number): PromiseOrNot<DebugProtocol.Capabilities>;
    launch(args: ILaunchRequestArgs, requestSeq?: number): PromiseOrNot<void>;
    attach(args: IAttachRequestArgs, requestSeq?: number): PromiseOrNot<void>;
    disconnect(args: DebugProtocol.DisconnectArguments): PromiseOrNot<void>;
    setBreakpoints(args: DebugProtocol.SetBreakpointsArguments, requestSeq?: number): PromiseOrNot<ISetBreakpointsResponseBody>;
    setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments, requestSeq?: number): PromiseOrNot<void>;
    configurationDone(): PromiseOrNot<void>;

    continue(): PromiseOrNot<void>;
    next(): PromiseOrNot<void>;
    stepIn(): PromiseOrNot<void>;
    stepOut(): PromiseOrNot<void>;
    pause(): PromiseOrNot<void>;

    stackTrace(args: DebugProtocol.StackTraceArguments, requestSeq?: number): PromiseOrNot<IStackTraceResponseBody>;
    scopes(args: DebugProtocol.ScopesArguments, requestSeq?: number): PromiseOrNot<IScopesResponseBody>;
    variables(args: DebugProtocol.VariablesArguments, requestSeq?: number): PromiseOrNot<IVariablesResponseBody>;
    source(args: DebugProtocol.SourceArguments, requestSeq?: number): PromiseOrNot<ISourceResponseBody>;
    threads(): PromiseOrNot<IThreadsResponseBody>;
    evaluate(args: DebugProtocol.EvaluateArguments, requestSeq?: number): PromiseOrNot<IEvaluateResponseBody>;
}

export interface IDebugTransformer {
    initialize?(args: DebugProtocol.InitializeRequestArguments, requestSeq?: number): PromiseOrNot<void>;
    launch?(args: ILaunchRequestArgs, requestSeq?: number): PromiseOrNot<void>;
    attach?(args: IAttachRequestArgs, requestSeq?: number): PromiseOrNot<void>;
    setBreakpoints?(args: DebugProtocol.SetBreakpointsArguments, requestSeq?: number): PromiseOrNot<void>;
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
