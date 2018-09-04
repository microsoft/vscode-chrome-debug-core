import { ITelemetryPropertyCollector, ISetBreakpointsResponseBody, IStackTraceResponseBody, IScopesResponseBody, IVariablesResponseBody, ISourceResponseBody, IEvaluateResponseBody, IGetLoadedSourcesResponseBody } from '../../../debugAdapterInterfaces';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ChromeDebugLogic, ILaunchRequestArgs, IAttachRequestArgs, IExceptionInfoResponseBody, IDebugAdapterState } from '../../..';
import { PromiseOrNot } from '../../utils/promises';

export abstract class UnconnectedCDACommonLogic implements IDebugAdapterState {
    public abstract chromeDebugAdapter(): ChromeDebugLogic;

    public initialize(_args: DebugProtocol.InitializeRequestArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<{capabilities: DebugProtocol.Capabilities, newState: IDebugAdapterState}> {
        return this.throwNotConnectedError();
    }

    public launch(_args: ILaunchRequestArgs, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): PromiseOrNot<IDebugAdapterState> {
        return this.throwNotConnectedError();
    }

    public attach(_args: IAttachRequestArgs, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): PromiseOrNot<IDebugAdapterState> {
        return this.throwNotConnectedError();
    }

    public restartFrame(_args: DebugProtocol.RestartFrameRequest): Promise<void> {
        return this.throwNotConnectedError();
    }

    public exceptionInfo(_args: DebugProtocol.ExceptionInfoArguments): Promise<IExceptionInfoResponseBody> {
        return this.throwNotConnectedError();
    }

    public shutdown(): void {
        return this.throwNotConnectedError();
    }

    public disconnect(_args: DebugProtocol.DisconnectArguments): Promise<void> {
        return this.throwNotConnectedError();
    }

    public setBreakpoints(_args: DebugProtocol.SetBreakpointsArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<ISetBreakpointsResponseBody> {
        return this.throwNotConnectedError();
    }

    public setExceptionBreakpoints(_args: DebugProtocol.SetExceptionBreakpointsArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<void> {
        return this.throwNotConnectedError();
    }

    public configurationDone(): Promise<void> {
        return this.throwNotConnectedError();
    }

    public continue(): Promise<void> {

        return this.throwNotConnectedError();
    }

    public next(): Promise<void> {

        return this.throwNotConnectedError();
    }

    public stepIn(): Promise<void> {

        return this.throwNotConnectedError();
    }

    public stepOut(): Promise<void> {
        return this.throwNotConnectedError();
    }

    public pause(): Promise<void> {
        return this.throwNotConnectedError();
    }

    public stackTrace(_args: DebugProtocol.StackTraceArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IStackTraceResponseBody> {
        return this.throwNotConnectedError();
    }

    public scopes(_args: DebugProtocol.ScopesArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IScopesResponseBody> {
        return this.throwNotConnectedError();
    }

    public variables(_args: DebugProtocol.VariablesArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IVariablesResponseBody> {
        return this.throwNotConnectedError();
    }

    public source(_args: DebugProtocol.SourceArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<ISourceResponseBody> {
        return this.throwNotConnectedError();
    }

    public threads(): Promise<{ threads: DebugProtocol.Thread[]; }> {
        return this.throwNotConnectedError();
    }

    public evaluate(_args: DebugProtocol.EvaluateArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IEvaluateResponseBody> {
        return this.throwNotConnectedError();
    }

    public loadedSources(_args: DebugProtocol.LoadedSourcesArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IGetLoadedSourcesResponseBody> {
        return this.throwNotConnectedError();
    }

    public setFunctionBreakpoints(_args: DebugProtocol.SetFunctionBreakpointsArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<DebugProtocol.SetFunctionBreakpointsResponse> {
        return this.throwNotConnectedError();
    }

    public setVariable(_args: DebugProtocol.SetVariableArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<DebugProtocol.SetVariableResponse> {
        return this.throwNotConnectedError();
    }

    private throwNotConnectedError(): never {
        throw new Error("Can't execute this request when the debug adapter is not connected to the target");
    }
}