import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { Crdp, utils, inject } from '../..';
import { PausedEvent, SetVariableValueRequest, ScriptParsedEvent } from './events';
import { IScript } from '../internal/scripts/script';
import { EvaluateOnCallFrameRequest } from './requests';
import { TargetToInternal } from './targetToInternal';
import { InternalToTarget } from './internalToTarget';
import { asyncMap } from '../collections/async';
import { ICallFrame } from '../internal/stackTraces/callFrame';
import { PauseOnExceptionsStrategy, PauseOnAllExceptions, PauseOnUnhandledExceptions, DoNotPauseOnAnyExceptions } from '../internal/exceptions/strategies';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';

export type ScriptParsedListener = (params: ScriptParsedEvent) => void;

export interface IBreakpointFeaturesSupport {
    supportsColumnBreakpoints(): Promise<boolean>;
}

export interface IDebugeeStepping {
    stepOver(): Promise<void>;
    stepInto(params: { breakOnAsyncCall: boolean }): Promise<void>;
    stepOut(): Promise<void>;
    restartFrame(callFrame: ICallFrame<IScript>): Promise<Crdp.Debugger.RestartFrameResponse>;
}

export interface IDebugeeExecutionControl {
    resume(): Promise<void>;
    pause(): Promise<void>;
}

export interface IPauseOnExceptions {
    setPauseOnExceptions(strategy: PauseOnExceptionsStrategy): Promise<void>;
}

export interface IAsyncDebuggingConfiguration {
    setAsyncCallStackDepth(maxDepth: Crdp.integer): Promise<void>;
}

export interface IScriptSources {
    getScriptSource(script: IScript): Promise<string>;
}

export class CDTPDebugger extends CDTPEventsEmitterDiagnosticsModule<Crdp.DebuggerApi> implements IDebugeeStepping, IDebugeeExecutionControl,
    IBreakpointFeaturesSupport, IPauseOnExceptions, IBreakpointFeaturesSupport, IScriptSources {
    private _firstScriptWasParsed = utils.promiseDefer<Crdp.Runtime.ScriptId>();

    public onScriptParsed = this.addApiListener('scriptParsed', async (params: Crdp.Debugger.ScriptParsedEvent) => {
        // We resolve the promise waiting for the first script parse. This is used to detect column breakpoints support
        this._firstScriptWasParsed.resolve(params.scriptId);

        await this._crdpToInternal.createAndRegisterScript(params);

        return await this._crdpToInternal.toScriptParsedEvent(params);
    });

    public readonly onPaused = this.addApiListener('paused', async (params: Crdp.Debugger.PausedEvent) => {
        if (params.callFrames.length === 0) {
            throw new Error(`Expected a pause event to have at least a single call frame: ${JSON.stringify(params)}`);
        }

        const callFrames = await asyncMap(params.callFrames, (callFrame, index) => this._crdpToInternal.toCallFrame(index, callFrame));
        return new PausedEvent(callFrames, params.reason, params.data,
            this._crdpToInternal.getBPsFromIDs(params.hitBreakpoints),
            params.asyncStackTrace && await this._crdpToInternal.toStackTraceCodeFlow(params.asyncStackTrace),
            params.asyncStackTraceId, params.asyncCallStackTraceId);
    });

    public readonly onResumed = this.addApiListener('resumed', (params: void) => params);

    public readonly onScriptFailedToParse = this.addApiListener('resumed', (params: Crdp.Debugger.ScriptFailedToParseEvent) => params);

    public enable(): Promise<Crdp.Debugger.EnableResponse> {
        return this.api.enable();
    }

    public setAsyncCallStackDepth(params: Crdp.Debugger.SetAsyncCallStackDepthRequest): Promise<void> {
        return this.api.setAsyncCallStackDepth(params);
    }

    public pauseOnAsyncCall(params: Crdp.Debugger.PauseOnAsyncCallRequest): Promise<void> {
        return this.api.pauseOnAsyncCall(params);
    }

    public resume(): Promise<void> {
        return this.api.resume();
    }

    public setBlackboxedRanges(script: IScript, positions: Crdp.Debugger.ScriptPosition[]): Promise<void> {
        return this.api.setBlackboxedRanges({ scriptId: this._scriptsRegistry.getCrdpId(script), positions: positions });
    }

    public setBlackboxPatterns(params: Crdp.Debugger.SetBlackboxPatternsRequest): Promise<void> {
        return this.api.setBlackboxPatterns(params);
    }

    public setPauseOnExceptions(strategy: PauseOnExceptionsStrategy): Promise<void> {
        let state: 'none' | 'uncaught' | 'all';

        if (strategy instanceof PauseOnAllExceptions) {
            state = 'all';
        } else if (strategy instanceof PauseOnUnhandledExceptions) {
            state = 'uncaught';
        } else if (strategy instanceof DoNotPauseOnAnyExceptions) {
            state = 'none';
        } else {
            throw new Error(`Can't pause on exception using an unknown strategy ${strategy}`);
        }

        return this.api.setPauseOnExceptions({ state });
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

    public async getScriptSource(script: IScript): Promise<string> {
        return (await this.api.getScriptSource({ scriptId: this._scriptsRegistry.getCrdpId(script) })).scriptSource;
    }

    public evaluateOnCallFrame(params: EvaluateOnCallFrameRequest): Promise<Crdp.Debugger.EvaluateOnCallFrameResponse> {

        return this.api.evaluateOnCallFrame({
            callFrameId: this._internalToCRDP.getFrameId(params.frame.unmappedCallFrame),
            expression: this._internalToCRDP.addURLIfMissing(params.expression),
            objectGroup: params.objectGroup,
            includeCommandLineAPI: params.includeCommandLineAPI,
            silent: params.silent,
            returnByValue: params.returnByValue,
            generatePreview: params.generatePreview,
            throwOnSideEffect: params.throwOnSideEffect,
            timeout: params.timeout,
        });
    }

    public setVariableValue(params: SetVariableValueRequest): Promise<void> {
        return this.api.setVariableValue({
            callFrameId: this._internalToCRDP.getFrameId(params.frame),
            scopeNumber: params.scopeNumber,
            variableName: params.variableName,
            newValue: params.newValue
        });
    }

    public restartFrame(frame: ICallFrame<IScript>): Promise<Crdp.Debugger.RestartFrameResponse> {
        return this.api.restartFrame({ callFrameId: this._internalToCRDP.getFrameId(frame) });
    }

    public async supportsColumnBreakpoints(): Promise<boolean> {
        const scriptId = await this._firstScriptWasParsed.promise;

        try {
            await this.api.getPossibleBreakpoints({
                start: { scriptId, lineNumber: 0, columnNumber: 0 },
                end: { scriptId, lineNumber: 1, columnNumber: 0 },
                restrictToFunction: false
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    constructor(
        protected readonly api: Crdp.DebuggerApi,
        private readonly _crdpToInternal: TargetToInternal,
        private readonly _internalToCRDP: InternalToTarget,
        @inject(CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) {
        super();
    }
}
