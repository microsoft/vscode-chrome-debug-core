import { Protocol as CDTP } from 'devtools-protocol';
import { IScript } from '../internal/scripts/script';

import { ScriptOrSourceOrURLOrURLRegexp } from '../internal/locations/location';
import { ICallFrame, ScriptOrLoadedSource } from '../internal/stackTraces/callFrame';
import { IBPRecipe } from '../internal/breakpoints/bpRecipe';
import { CodeFlowStackTrace } from '../internal/stackTraces/codeFlowStackTrace';

export type integer = number;

/**
 * A new JavaScript Script has been parsed by the debuggee and it's about to be executed
 */
export interface ScriptParsedEvent {
    readonly script: IScript;
    readonly url: string;
    readonly startLine: integer;
    readonly startColumn: integer;
    readonly endLine: integer;
    readonly endColumn: integer;
    readonly executionContextId: CDTP.Runtime.ExecutionContextId;
    readonly hash: string;
    readonly executionContextAuxData?: any;
    readonly isLiveEdit?: boolean;
    readonly sourceMapURL?: string;
    readonly hasSourceURL?: boolean;
    readonly isModule?: boolean;
    readonly length?: integer;
    readonly stackTrace?: CodeFlowStackTrace;
}

export interface ConsoleAPICalledEvent {
    readonly type: ('log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd');
    readonly args: CDTP.Runtime.RemoteObject[];
    readonly executionContextId: CDTP.Runtime.ExecutionContextId;
    readonly timestamp: CDTP.Runtime.Timestamp;
    readonly stackTrace?: CodeFlowStackTrace;
    readonly context?: string;
}

export interface ExceptionThrownEvent {
    readonly timestamp: CDTP.Runtime.Timestamp;
    readonly exceptionDetails: ExceptionDetails;
}

export interface ExceptionDetails {
    readonly exceptionId: integer;
    readonly text: string;
    readonly lineNumber: integer;
    readonly columnNumber: integer;
    readonly script?: IScript;
    readonly url?: string;
    readonly stackTrace?: CodeFlowStackTrace;
    readonly exception?: CDTP.Runtime.RemoteObject;
    readonly executionContextId?: CDTP.Runtime.ExecutionContextId;
}

export interface SetVariableValueRequest {
    readonly scopeNumber: integer;
    readonly variableName: string;
    readonly newValue: CDTP.Runtime.CallArgument;
    readonly frame: ICallFrame<ScriptOrLoadedSource>;
}

export type LogEntrySource = 'xml' | 'javascript' | 'network' | 'storage' | 'appcache' | 'rendering' | 'security' | 'deprecation' | 'worker' | 'violation' | 'intervention' | 'recommendation' | 'other';
export type LogLevel = 'verbose' | 'info' | 'warning' | 'error';

export interface LogEntry {
    readonly source: LogEntrySource;
    readonly level: LogLevel;
    readonly text: string;
    readonly timestamp: CDTP.Runtime.Timestamp;
    readonly url?: string;
    readonly lineNumber?: integer;
    readonly stackTrace?: CodeFlowStackTrace;
    readonly networkRequestId?: CDTP.Network.RequestId;
    readonly workerId?: string;
    readonly args?: CDTP.Runtime.RemoteObject[];
}
