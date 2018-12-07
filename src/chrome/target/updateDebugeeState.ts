import { Crdp } from '../..';
import { SetVariableValueRequest } from './events';
import { CallFrameRegistry } from './callFrameRegistry';
import { TYPES } from '../dependencyInjection.ts/types';
import { injectable, inject } from 'inversify';

export interface IUpdateDebugeeState {
    setVariableValue(params: SetVariableValueRequest): Promise<void>;
}

@injectable()
export class UpdateDebugeeState implements IUpdateDebugeeState {
    public setVariableValue(params: SetVariableValueRequest): Promise<void> {
        return this.api.Debugger.setVariableValue({
            callFrameId: this._callFrameRegistry.getFrameId(params.frame),
            scopeNumber: params.scopeNumber,
            variableName: params.variableName,
            newValue: params.newValue
        });
    }

    constructor(
        @inject(TYPES.CDTPClient) private readonly api: Crdp.ProtocolApi,
        private readonly _callFrameRegistry: CallFrameRegistry) {
    }
}