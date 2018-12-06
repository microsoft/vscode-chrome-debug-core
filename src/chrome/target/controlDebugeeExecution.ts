import { Crdp } from '../..';

import { ICallFrame } from '../internal/stackTraces/callFrame';

import { IScript } from '../internal/scripts/script';
import { CallFrameRegistry } from './callFrameRegistry';

export interface IDebugeeExecutionControl {
    resume(): Promise<void>;
    pause(): Promise<void>;
}

export interface IDebugeeStepping {
    stepOver(): Promise<void>;
    stepInto(params: { breakOnAsyncCall: boolean }): Promise<void>;
    stepOut(): Promise<void>;
    restartFrame(callFrame: ICallFrame<IScript>): Promise<Crdp.Debugger.RestartFrameResponse>;
}

export class ControlDebugeeExecution implements IDebugeeExecutionControl, IDebugeeStepping {
    public pauseOnAsyncCall(params: Crdp.Debugger.PauseOnAsyncCallRequest): Promise<void> {
        return this.api.pauseOnAsyncCall(params);
    }

    public resume(): Promise<void> {
        return this.api.resume();
    }

    public stepOver(): Promise<void> {
        return this.api.stepOver();
    }

    public stepInto(params: Crdp.Debugger.StepIntoRequest): Promise<void> {
        return this.api.stepInto(params);
    }

    public stepOut(): Promise<void> {
        return this.api.stepOut();
    }

    public pause(): Promise<void> {
        return this.api.pause();
    }

    public restartFrame(frame: ICallFrame<IScript>): Promise<Crdp.Debugger.RestartFrameResponse> {
        return this.api.restartFrame({ callFrameId: this._callFrameRegistry.getFrameId(frame) });
    }

    constructor(
        protected readonly api: Crdp.DebuggerApi,
        private readonly _callFrameRegistry: CallFrameRegistry) {
    }
}