import { EvaluateOnCallFrameRequest } from './requests';
import { Crdp } from '../..';
import { CallFrameRegistry } from './callFrameRegistry';
import { AddSourceUriToExpession } from './addSourceUriToExpression';

export interface IInspectDebugeeState {
    callFunctionOn(params: Crdp.Runtime.CallFunctionOnRequest): Promise<Crdp.Runtime.CallFunctionOnResponse>;
    getProperties(params: Crdp.Runtime.GetPropertiesRequest): Promise<Crdp.Runtime.GetPropertiesResponse>;
    evaluate(params: Crdp.Runtime.EvaluateRequest): Promise<Crdp.Runtime.EvaluateResponse>;
    evaluateOnCallFrame(params: EvaluateOnCallFrameRequest): Promise<Crdp.Debugger.EvaluateOnCallFrameResponse>;
}

export class InspectDebugeeState implements IInspectDebugeeState {
    private addSourceUriToEvaluates = new AddSourceUriToExpession('evaluateOnFrame');

    public callFunctionOn(params: Crdp.Runtime.CallFunctionOnRequest): Promise<Crdp.Runtime.CallFunctionOnResponse> {
        return this.api.Runtime.callFunctionOn(params);
    }

    public getProperties(params: Crdp.Runtime.GetPropertiesRequest): Promise<Crdp.Runtime.GetPropertiesResponse> {
        return this.api.Runtime.getProperties(params);
    }

    public evaluate(params: Crdp.Runtime.EvaluateRequest): Promise<Crdp.Runtime.EvaluateResponse> {
        params.expression = this.addSourceUriToEvaluates.addURLIfMissing(params.expression);
        return this.api.Runtime.evaluate(params);
    }

    public evaluateOnCallFrame(params: EvaluateOnCallFrameRequest): Promise<Crdp.Debugger.EvaluateOnCallFrameResponse> {
        return this.api.Debugger.evaluateOnCallFrame({
            callFrameId: this._callFrameRegistry.getFrameId(params.frame.unmappedCallFrame),
            expression: this.addSourceUriToEvaluates.addURLIfMissing(params.expression),
            objectGroup: params.objectGroup,
            includeCommandLineAPI: params.includeCommandLineAPI,
            silent: params.silent,
            returnByValue: params.returnByValue,
            generatePreview: params.generatePreview,
            throwOnSideEffect: params.throwOnSideEffect,
            timeout: params.timeout,
        });
    }

    constructor(
        protected readonly api: Crdp.ProtocolApi,
        private readonly _callFrameRegistry: CallFrameRegistry) {
    }
}