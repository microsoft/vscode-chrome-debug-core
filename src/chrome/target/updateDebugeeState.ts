import { Crdp } from '../..';
import { SetVariableValueRequest } from './events';
import { CallFrameRegistry } from './callFrameRegistry';

export interface IUpdateDebugeeState {
    setVariableValue(params: SetVariableValueRequest): Promise<void>;
}

export class UpdateDebugeeState implements IUpdateDebugeeState {
    public setVariableValue(params: SetVariableValueRequest): Promise<void> {
        return this.api.setVariableValue({
            callFrameId: this._callFrameRegistry.getFrameId(params.frame),
            scopeNumber: params.scopeNumber,
            variableName: params.variableName,
            newValue: params.newValue
        });
    }

    constructor(
        protected readonly api: Crdp.DebuggerApi,
        private readonly _callFrameRegistry: CallFrameRegistry) {
    }
}