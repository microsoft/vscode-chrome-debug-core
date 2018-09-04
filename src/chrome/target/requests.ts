import { Crdp } from '../..';
import { LocationInScript, ScriptOrSource } from '../internal/locations/location';
import { ICallFrame } from '../internal/stackTraces/callFrame';

export interface INewSetBreakpointResult {
    readonly breakpointId?: Crdp.Debugger.BreakpointId;
    readonly actualLocation?: LocationInScript;
}

export interface INewAddBreakpointsResult {
    readonly breakpointId?: Crdp.Debugger.BreakpointId;
    readonly actualLocation?: LocationInScript & { scriptId?: Crdp.Runtime.ScriptId }; // TODO: node-debug2 is currently using the scriptId property
}

export interface EvaluateOnCallFrameRequest {
    readonly frame: ICallFrame<ScriptOrSource>;
    readonly expression: string;
    readonly objectGroup?: string;
    readonly includeCommandLineAPI?: boolean;
    readonly silent?: boolean;
    readonly returnByValue?: boolean;
    readonly generatePreview?: boolean;
    readonly throwOnSideEffect?: boolean;
    readonly timeout?: Crdp.Runtime.TimeDelta;
}