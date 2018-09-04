import {
    IDebugAdapter, ITelemetryPropertyCollector, PromiseOrNot, ILaunchRequestArgs, IAttachRequestArgs, IThreadsResponseBody,
    ISetBreakpointsResponseBody, IStackTraceResponseBody, IScopesResponseBody, IVariablesResponseBody, ISourceResponseBody,
    IEvaluateResponseBody, IExceptionInfoResponseBody, IGetLoadedSourcesResponseBody, IDebugAdapterState
} from '../../..';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IChromeDebugAdapterOpts, ChromeDebugSession } from '../../chromeDebugSession';
import { ChromeConnection } from '../../chromeConnection';
import { StepProgressEventsEmitter } from '../../../executionTimingsReporter';
import { UninitializedCDA } from './uninitializedCDA';

export class ChromeDebugAdapter implements IDebugAdapter {
    private _state: IDebugAdapterState;

    public events = new StepProgressEventsEmitter();

    constructor(args: IChromeDebugAdapterOpts, originalSession: ChromeDebugSession) {
        // Copy the arguments to keep backwards compatibility. TODO DIEGO remove this
        args.extensibilityPoints.chromeConnection = args.extensibilityPoints.chromeConnection || args.chromeConnection;
        args.extensibilityPoints.pathTransformer = args.extensibilityPoints.pathTransformer || args.pathTransformer;
        args.extensibilityPoints.sourceMapTransformer = args.extensibilityPoints.sourceMapTransformer || args.sourceMapTransformer;
        args.extensibilityPoints.lineColTransformer = args.extensibilityPoints.lineColTransformer || args.lineColTransformer;
        args.extensibilityPoints.enableSourceMapCaching = args.extensibilityPoints.enableSourceMapCaching || args.enableSourceMapCaching;
        args.extensibilityPoints.targetFilter = args.extensibilityPoints.targetFilter || args.targetFilter;

        this._state = new UninitializedCDA(args.extensibilityPoints, originalSession, args.chromeConnection || ChromeConnection);
    }

    public shutdown(): void {
        return this._state.shutdown();
    }

    public async initialize(args: DebugProtocol.InitializeRequestArguments, _?: ITelemetryPropertyCollector, _2?: number): Promise<DebugProtocol.Capabilities> {
        const { capabilities, newState } = await this._state.initialize(args);
        this._state = newState;
        return capabilities;
    }

    public async launch(args: ILaunchRequestArgs, _?: ITelemetryPropertyCollector, _2?: number): Promise<void> {
        this._state = await this._state.launch(args);
    }

    public async attach(args: IAttachRequestArgs, _?: ITelemetryPropertyCollector, _2?: number): Promise<void> {
        this._state = await this._state.attach(args);
    }

    public disconnect(args: DebugProtocol.DisconnectArguments): PromiseOrNot<void> {
        return this._state.disconnect(args);
    }

    public async setBreakpoints(args: DebugProtocol.SetBreakpointsArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector): Promise<ISetBreakpointsResponseBody> {
        return this._state.setBreakpoints(args, telemetryPropertyCollector);
    }

    public async setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments, _?: ITelemetryPropertyCollector, _2?: number): Promise<void> {
        return this._state.setExceptionBreakpoints(args);
    }

    public configurationDone(): PromiseOrNot<void> {
        return this._state.configurationDone();
    }

    public continue(): PromiseOrNot<void> {
        return this._state.continue();
    }

    public next(): PromiseOrNot<void> {
        return this._state.next();
    }

    public stepIn(): PromiseOrNot<void> {
        return this._state.stepIn();
    }

    public stepOut(): PromiseOrNot<void> {
        return this._state.stepOut();
    }

    public pause(): PromiseOrNot<void> {
        return this._state.pause();
    }

    public async restartFrame(args: DebugProtocol.RestartFrameRequest): Promise<void> {
        return this._state.restartFrame(args);
    }

    public async stackTrace(args: DebugProtocol.StackTraceArguments, _?: ITelemetryPropertyCollector, _2?: number): Promise<IStackTraceResponseBody> {
        return this._state.stackTrace(args);
    }

    public scopes(args: DebugProtocol.ScopesArguments, _?: ITelemetryPropertyCollector, _2?: number): PromiseOrNot<IScopesResponseBody> {
        return this._state.scopes(args);
    }

    public variables(args: DebugProtocol.VariablesArguments, _?: ITelemetryPropertyCollector, _2?: number): PromiseOrNot<IVariablesResponseBody> {
        return this._state.variables(args);
    }

    public async source(args: DebugProtocol.SourceArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<ISourceResponseBody> {
        return this._state.source(args, _telemetryPropertyCollector);
    }

    public threads(): PromiseOrNot<IThreadsResponseBody> {
        return this._state.threads();
    }

    public async evaluate(args: DebugProtocol.EvaluateArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IEvaluateResponseBody> {
        return this._state.evaluate(args, _telemetryPropertyCollector);
    }

    public async loadedSources(args: DebugProtocol.LoadedSourcesArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): Promise<IGetLoadedSourcesResponseBody> {
        return this._state.loadedSources(args, telemetryPropertyCollector, requestSeq);
    }

    public setFunctionBreakpoints(_args: DebugProtocol.SetFunctionBreakpointsArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): PromiseOrNot<DebugProtocol.SetFunctionBreakpointsResponse> {
        throw new Error('Method not implemented.');
    }

    public setVariable(_args: DebugProtocol.SetVariableArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): PromiseOrNot<DebugProtocol.SetVariableResponse> {
        throw new Error('Method not implemented.');
    }

    public async exceptionInfo(args: DebugProtocol.ExceptionInfoArguments): Promise<IExceptionInfoResponseBody> {
        return this._state.exceptionInfo(args);
    }
}