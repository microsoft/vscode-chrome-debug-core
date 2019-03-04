/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { ScriptCallFrame } from '../../internal/stackTraces/callFrame';
import { CDTPCallFrameRegistry } from '../registries/cdtpCallFrameRegistry';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface IDebugeeSteppingController {
    stepOver(): Promise<void>;
    stepInto(params: { breakOnAsyncCall: boolean }): Promise<void>;
    stepOut(): Promise<void>;
    restartFrame(callFrame: ScriptCallFrame): Promise<CDTP.Debugger.RestartFrameResponse>;
    pauseOnAsyncCall(params: CDTP.Debugger.PauseOnAsyncCallRequest): Promise<void>;
}

@injectable()
export class CDTPDebugeeSteppingController implements IDebugeeSteppingController {
    constructor(
        @inject(TYPES.CDTPClient)
        protected readonly api: CDTP.ProtocolApi,
        private readonly _callFrameRegistry: CDTPCallFrameRegistry) {
    }

    public pauseOnAsyncCall(params: CDTP.Debugger.PauseOnAsyncCallRequest): Promise<void> {
        return this.api.Debugger.pauseOnAsyncCall(params);
    }

    public stepOver(): Promise<void> {
        return this.api.Debugger.stepOver();
    }

    public stepInto(params: CDTP.Debugger.StepIntoRequest): Promise<void> {
        return this.api.Debugger.stepInto(params);
    }

    public stepOut(): Promise<void> {
        return this.api.Debugger.stepOut();
    }

    public restartFrame(frame: ScriptCallFrame): Promise<CDTP.Debugger.RestartFrameResponse> {
        return this.api.Debugger.restartFrame({ callFrameId: this._callFrameRegistry.getFrameId(frame) });
    }
}
