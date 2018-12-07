import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { Crdp } from '../..';
import { ScriptParsedEvent } from './events';
import { IScript } from '../internal/scripts/script';
import { PauseOnExceptionsStrategy, PauseOnAllExceptions, PauseOnUnhandledExceptions, DoNotPauseOnAnyExceptions } from '../internal/exceptions/strategies';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';
import { inject, injectable } from 'inversify';
import { TYPES } from '../dependencyInjection.ts/types';

export type ScriptParsedListener = (params: ScriptParsedEvent) => void;

export interface IPauseOnExceptions {
    setPauseOnExceptions(strategy: PauseOnExceptionsStrategy): Promise<void>;
}

export interface IAsyncDebuggingConfiguration {
    setAsyncCallStackDepth(maxDepth: Crdp.integer): Promise<void>;
}

export interface IScriptSources {
    getScriptSource(script: IScript): Promise<string>;
}

@injectable()
export class CDTPDebugger extends CDTPEventsEmitterDiagnosticsModule<Crdp.DebuggerApi> implements IPauseOnExceptions, IScriptSources, IAsyncDebuggingConfiguration {
    protected readonly api = this._protocolApi.Debugger;

    public enable(): Promise<Crdp.Debugger.EnableResponse> {
        return this.api.enable();
    }

    public setAsyncCallStackDepth(maxDepth: Crdp.integer): Promise<void> {
        return this.api.setAsyncCallStackDepth({ maxDepth });
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

    public async getScriptSource(script: IScript): Promise<string> {
        return (await this.api.getScriptSource({ scriptId: this._scriptsRegistry.getCrdpId(script) })).scriptSource;
    }

    constructor(
        @inject(TYPES.CDTPClient) private readonly _protocolApi: Crdp.ProtocolApi,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) {
        super();
    }
}
