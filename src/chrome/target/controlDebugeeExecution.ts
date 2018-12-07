import { Crdp } from '../..';

import { ICallFrame } from '../internal/stackTraces/callFrame';

import { IScript } from '../internal/scripts/script';
import { CallFrameRegistry } from './callFrameRegistry';
import { injectable, inject } from 'inversify';
import { TYPES } from '../dependencyInjection.ts/types';

export interface IDebugeeExecutionControl {
    resume(): Promise<void>;
    pause(): Promise<void>;
}

export interface IDebugeeStepping {
    stepOver(): Promise<void>;
    stepInto(params: { breakOnAsyncCall: boolean }): Promise<void>;
    stepOut(): Promise<void>;
    restartFrame(callFrame: ICallFrame<IScript>): Promise<Crdp.Debugger.RestartFrameResponse>;
    pauseOnAsyncCall(params: Crdp.Debugger.PauseOnAsyncCallRequest): Promise<void>;
}

@injectable()
export class ControlDebugeeExecution implements IDebugeeExecutionControl, IDebugeeStepping {
    public pauseOnAsyncCall(params: Crdp.Debugger.PauseOnAsyncCallRequest): Promise<void> {
        return this.api.Debugger.pauseOnAsyncCall(params);
    }

    public resume(): Promise<void> {
        return this.api.Debugger.resume();
    }

    public stepOver(): Promise<void> {
        return this.api.Debugger.stepOver();
    }

    public stepInto(params: Crdp.Debugger.StepIntoRequest): Promise<void> {
        return this.api.Debugger.stepInto(params);
    }

    public stepOut(): Promise<void> {
        return this.api.Debugger.stepOut();
    }

    public pause(): Promise<void> {
        return this.api.Debugger.pause();
    }

    public restartFrame(frame: ICallFrame<IScript>): Promise<Crdp.Debugger.RestartFrameResponse> {
        return this.api.Debugger.restartFrame({ callFrameId: this._callFrameRegistry.getFrameId(frame) });
    }

    constructor(
        @inject(TYPES.CDTPClient) protected readonly api: Crdp.ProtocolApi,
        private readonly _callFrameRegistry: CallFrameRegistry) {
    }
}