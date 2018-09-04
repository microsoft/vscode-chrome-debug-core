import { IScript } from '../internal/scripts/script';

import { Crdp } from '../..';

import { ScriptOrSource, ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { CodeFlowStackTrace } from '../internal/stackTraces/stackTrace';
import { ICallFrame } from '../internal/stackTraces/callFrame';
import { IBPRecipie } from '../internal/breakpoints/bpRecipie';

export type integer = number;

export interface ScriptParsedEvent {
    readonly script: IScript;
    readonly url: string;
    readonly startLine: integer;
    readonly startColumn: integer;
    readonly endLine: integer;
    readonly endColumn: integer;
    readonly executionContextId: Crdp.Runtime.ExecutionContextId;
    readonly hash: string;
    readonly executionContextAuxData?: any;
    readonly isLiveEdit?: boolean;
    readonly sourceMapURL?: string;
    readonly hasSourceURL?: boolean;
    readonly isModule?: boolean;
    readonly length?: integer;
    readonly stackTrace?: CodeFlowStackTrace<IScript>;
}

export class PausedEvent {
    public cloneButWithHitBreakpoints(hitBreakpoints: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>[]): PausedEvent {
        return new PausedEvent(
            this.callFrames,
            this.reason,
            this.data,
            hitBreakpoints,
            this.asyncStackTrace,
            this.asyncCallStackTraceId,
            this.asyncStackTraceId);
    }

    constructor(
        public readonly callFrames: NonNullable<ICallFrame<IScript>[]>,
        public readonly reason: ('XHR' | 'DOM' | 'EventListener' | 'exception' | 'assert' | 'debugCommand' | 'promiseRejection' | 'OOM' | 'other' | 'ambiguous'),
        public readonly data?: any,
        public readonly hitBreakpoints?: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>[], // TODO DIEGO: Make this readonly
        public readonly asyncStackTrace?: CodeFlowStackTrace<IScript>,
        public readonly asyncStackTraceId?: Crdp.Runtime.StackTraceId,
        public readonly asyncCallStackTraceId?: Crdp.Runtime.StackTraceId) { }
}

export interface ConsoleAPICalledEvent {
    readonly type: ('log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd');
    readonly args: Crdp.Runtime.RemoteObject[];
    readonly executionContextId: Crdp.Runtime.ExecutionContextId;
    readonly timestamp: Crdp.Runtime.Timestamp;
    readonly stackTrace?: CodeFlowStackTrace<IScript>;
    readonly context?: string;
}

export interface ExceptionThrownEvent {
    readonly timestamp: Crdp.Runtime.Timestamp;
    readonly exceptionDetails: ExceptionDetails;
}

export interface ExceptionDetails {
    readonly exceptionId: integer;
    readonly text: string;
    readonly lineNumber: integer;
    readonly columnNumber: integer;
    readonly script?: IScript;
    readonly url?: string;
    readonly stackTrace?: CodeFlowStackTrace<IScript>;
    readonly exception?: Crdp.Runtime.RemoteObject;
    readonly executionContextId?: Crdp.Runtime.ExecutionContextId;
}

export interface SetVariableValueRequest {
    readonly scopeNumber: integer;
    readonly variableName: string;
    readonly newValue: Crdp.Runtime.CallArgument;
    readonly frame: ICallFrame<ScriptOrSource>;
}

export type LogEntrySource = 'xml' | 'javascript' | 'network' | 'storage' | 'appcache' | 'rendering' | 'security' | 'deprecation' | 'worker' | 'violation' | 'intervention' | 'recommendation' | 'other';
export type LogLevel = 'verbose' | 'info' | 'warning' | 'error';

export interface LogEntry {
    readonly source: LogEntrySource;
    readonly level: LogLevel;
    readonly text: string;
    readonly timestamp: Crdp.Runtime.Timestamp;
    readonly url?: string;
    readonly lineNumber?: integer;
    readonly stackTrace?: CodeFlowStackTrace<IScript>;
    readonly networkRequestId?: Crdp.Network.RequestId;
    readonly workerId?: string;
    readonly args?: Crdp.Runtime.RemoteObject[];
}
