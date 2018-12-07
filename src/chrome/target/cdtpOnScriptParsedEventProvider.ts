import { Crdp, parseResourceIdentifier, BasePathTransformer, BaseSourceMapTransformer } from '../..';
import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';
import { IScript, Script } from '../internal/scripts/script';
import { CDTPScriptUrl } from '../internal/sources/resourceIdentifierSubtypes';
import { SourcesMapper, NoSourceMapping } from '../internal/scripts/sourcesMapper';
import { ResourceName } from '../internal/sources/resourceIdentifier';
import { ScriptParsedEvent } from './events';
import { TYPES } from '../dependencyInjection.ts/types';
import { CDTPStackTraceParser } from './cdtpStackTraceParser';
import { inject } from 'inversify';

export class CDTPOnScriptParsedEventProvider extends CDTPEventsEmitterDiagnosticsModule<Crdp.DebuggerApi> {
    protected readonly api = this._protocolApi.Debugger;

    public onScriptParsed = this.addApiListener('scriptParsed', async (params: Crdp.Debugger.ScriptParsedEvent) => {
        await this.createAndRegisterScript(params);

        return await this.toScriptParsedEvent(params);
    });

    private async createAndRegisterScript(params: Crdp.Debugger.ScriptParsedEvent): Promise<IScript> {
        // The stack trace and hash can be large and the DA doesn't need it.
        delete params.stackTrace;
        delete params.hash;

        const executionContext = this._scriptsRegistry.getExecutionContextById(params.executionContextId);

        const script = await this._scriptsRegistry.registerNewScript(params.scriptId, async () => {
            if (params.url !== undefined && params.url !== '') {
                const runtimeSourceLocation = parseResourceIdentifier<CDTPScriptUrl>(params.url as CDTPScriptUrl);
                const developmentSourceLocation = await this._pathTransformer.scriptParsed(runtimeSourceLocation);
                const sourceMap = await this._sourceMapTransformer.scriptParsed(runtimeSourceLocation.canonicalized, params.sourceMapURL);
                const sourceMapper = sourceMap
                    ? new SourcesMapper(sourceMap)
                    : new NoSourceMapping();

                const runtimeScript = Script.create(executionContext, runtimeSourceLocation, developmentSourceLocation, sourceMapper);
                return runtimeScript;
            } else {
                const sourceMap = await this._sourceMapTransformer.scriptParsed('', params.sourceMapURL);
                const sourceMapper = sourceMap
                    ? new SourcesMapper(sourceMap)
                    : new NoSourceMapping();
                const runtimeScript = Script.createEval(executionContext, new ResourceName(params.scriptId as CDTPScriptUrl), sourceMapper);
                return runtimeScript;
            }
        });

        return script;
    }

    private async toScriptParsedEvent(params: Crdp.Debugger.ScriptParsedEvent): Promise<ScriptParsedEvent> {
        return {
            script: await this._scriptsRegistry.getScriptById(params.scriptId),
            url: params.url,
            startLine: params.startLine,
            startColumn: params.startColumn,
            endLine: params.endLine,
            endColumn: params.endColumn,
            executionContextId: params.executionContextId,
            hash: params.hash,
            executionContextAuxData: params.executionContextAuxData,
            isLiveEdit: params.isLiveEdit,
            sourceMapURL: params.sourceMapURL,
            hasSourceURL: params.hasSourceURL,
            isModule: params.isModule,
            length: params.length,
            stackTrace: params.stackTrace && await this._crdpToInternal.toStackTraceCodeFlow(params.stackTrace)
        };
    }

    constructor(
        private readonly _protocolApi: Crdp.ProtocolApi,
        @inject(TYPES.CDTPStackTraceParser) private readonly _crdpToInternal: CDTPStackTraceParser,
        @inject(TYPES.BasePathTransformer) private readonly _pathTransformer: BasePathTransformer,
        @inject(TYPES.BaseSourceMapTransformer) private readonly _sourceMapTransformer: BaseSourceMapTransformer,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) {
        super();
    }
}