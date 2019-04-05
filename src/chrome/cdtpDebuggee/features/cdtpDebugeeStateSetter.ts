/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { Protocol as CDTP } from 'devtools-protocol';
import { CDTPCallFrameRegistry } from '../registries/cdtpCallFrameRegistry';
import { TYPES } from '../../dependencyInjection.ts/types';
import { injectable, inject } from 'inversify';
import { ScriptCallFrame, CallFrameWithState } from '../../internal/stackTraces/callFrame';
import { integer } from '../cdtpPrimitives';

export interface ISetVariableValueRequest {
    readonly scopeNumber: integer;
    readonly variableName: string;
    readonly newValue: CDTP.Runtime.CallArgument;
    readonly frame: ScriptCallFrame<CallFrameWithState>;
}

export interface IDebuggeeStateSetter {
    setVariableValue(params: ISetVariableValueRequest): Promise<void>;
}

@injectable()
export class CDTPDebuggeeStateSetter implements IDebuggeeStateSetter {
    constructor(
        @inject(TYPES.CDTPClient) private readonly api: CDTP.ProtocolApi,
        private readonly _callFrameRegistry: CDTPCallFrameRegistry) {
    }

    public setVariableValue(params: ISetVariableValueRequest): Promise<void> {
        return this.api.Debugger.setVariableValue({
            callFrameId: this._callFrameRegistry.getFrameId(params.frame),
            scopeNumber: params.scopeNumber,
            variableName: params.variableName,
            newValue: params.newValue
        });
    }
}