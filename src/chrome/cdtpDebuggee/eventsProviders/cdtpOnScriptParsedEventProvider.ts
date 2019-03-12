/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { CDTPEventsEmitterDiagnosticsModule } from '../infrastructure/cdtpDiagnosticsModule';
import { CDTPScriptsRegistry } from '../registries/cdtpScriptsRegistry';
import { IScript, Script } from '../../internal/scripts/script';
import { createCDTPScriptUrl, CDTPScriptUrl } from '../../internal/sources/resourceIdentifierSubtypes';
import { MappedSourcesMapper, IMappedSourcesMapper, NoMappedSourcesMapper } from '../../internal/scripts/sourcesMapper';
import { IResourceIdentifier, ResourceName, parseResourceIdentifier } from '../../internal/sources/resourceIdentifier';
import { TYPES } from '../../dependencyInjection.ts/types';
import { inject } from 'inversify';
import { integer } from '../cdtpPrimitives';
import { IExecutionContext } from '../../internal/scripts/executionContext';
import { CDTPDomainsEnabler } from '../infrastructure/cdtpDomainsEnabler';
import { LoadedSourcesRegistry } from '../registries/loadedSourcesRegistry';
import { ILoadedSource, SourceScriptRelationship } from '../../internal/sources/loadedSource';
import { IdentifiedLoadedSource } from '../../internal/sources/identifiedLoadedSource';
import { DevelopmentSourceOf, RuntimeSourceOf, MappedSourceOf } from '../../internal/sources/loadedSourceToScriptRelationship';
import { Position } from '../../internal/locations/location';
import { createLineNumber, createColumnNumber } from '../../internal/locations/subtypes';
import { RangeInResource } from '../../internal/locations/rangeInScript';
import * as _ from 'lodash';
import { SourceMap } from '../../../sourceMaps/sourceMap';
import { BasePathTransformer } from '../../../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../../../transformers/baseSourceMapTransformer';

/**
 * A new JavaScript Script has been parsed by the debuggee and it's about to be executed
 */
export interface IScriptParsedEvent {
    readonly script: IScript;
    readonly url: string;
    readonly startLine: integer;
    readonly startColumn: integer;
    readonly endLine: integer;
    readonly endColumn: integer;
    readonly executionContext: IExecutionContext;
    readonly executionContextAuxData?: any;
    readonly isLiveEdit?: boolean;
    readonly sourceMapURL?: string;
    readonly hasSourceURL?: boolean;
    readonly isModule?: boolean;
    readonly length?: integer;
}

export class ScriptParsedEvent implements IScriptParsedEvent {
    public readonly script: IScript;
    public readonly url: string;
    public readonly startLine: integer;
    public readonly startColumn: integer;
    public readonly endLine: integer;
    public readonly endColumn: integer;
    public readonly executionContext: IExecutionContext;
    public readonly executionContextAuxData?: any;
    public readonly isLiveEdit?: boolean;
    public readonly sourceMapURL?: string;
    public readonly hasSourceURL?: boolean;
    public readonly isModule?: boolean;
    public readonly length?: integer;

    public constructor(parsedEvent: IScriptParsedEvent) {
        this.script = parsedEvent.script;
        this.url = parsedEvent.url;
        this.startLine = parsedEvent.startLine;
        this.startColumn = parsedEvent.startColumn;
        this.endLine = parsedEvent.endLine;
        this.endColumn = parsedEvent.endColumn;
        this.executionContext = parsedEvent.executionContext;
        this.executionContextAuxData = parsedEvent.executionContextAuxData;
        this.isLiveEdit = parsedEvent.isLiveEdit;
        this.sourceMapURL = parsedEvent.sourceMapURL;
        this.hasSourceURL = parsedEvent.hasSourceURL;
        this.isModule = parsedEvent.isModule;
        this.length = parsedEvent.length;
    }

    public toString() {
        return `Script was parsed: ${this.script} with development source: ${this.script.developmentSource} and mapped sources: ${this.script.mappedSources.join(', ')}`;
    }
}

export type ScriptParsedListener = (params: IScriptParsedEvent) => void;

export interface IScriptParsedProvider {
    onScriptParsed(listener: (event: IScriptParsedEvent) => void): void;
}

export class CDTPOnScriptParsedEventProvider extends CDTPEventsEmitterDiagnosticsModule<CDTP.DebuggerApi, void, CDTP.Debugger.EnableResponse> implements IScriptParsedProvider {
    protected readonly api = this._protocolApi.Debugger;

    public onScriptParsed = this.addApiListener('scriptParsed', async (params: CDTP.Debugger.ScriptParsedEvent) => {
        const creator = !!params.url ? IdentifiedScriptCreator : UnidentifiedScriptCreator;
        await new creator(this._scriptsRegistry, this._loadedSourcesRegistry, this._pathTransformer, this._sourceMapTransformer, params).createAndRegisterScript();

        return await this.toScriptParsedEvent(params);
    });

    constructor(
        @inject(TYPES.CDTPClient) private readonly _protocolApi: CDTP.ProtocolApi,
        @inject(TYPES.BasePathTransformer) private readonly _pathTransformer: BasePathTransformer,
        @inject(TYPES.BaseSourceMapTransformer) private readonly _sourceMapTransformer: BaseSourceMapTransformer,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry,
        @inject(TYPES.IDomainsEnabler) domainsEnabler: CDTPDomainsEnabler,
        @inject(LoadedSourcesRegistry) private readonly _loadedSourcesRegistry: LoadedSourcesRegistry,
    ) {
        super(domainsEnabler);
    }

    private async toScriptParsedEvent(params: CDTP.Debugger.ScriptParsedEvent): Promise<IScriptParsedEvent> {
        const executionContext = this._scriptsRegistry.getExecutionContextById(params.executionContextId);

        // The stack trace and hash can be large and the DA doesn't need it, so we don't use those properties
        return new ScriptParsedEvent(
            {
                url: params.url,
                startLine: params.startLine,
                startColumn: params.startColumn,
                endLine: params.endLine,
                endColumn: params.endColumn,
                executionContext: executionContext,
                executionContextAuxData: params.executionContextAuxData,
                isLiveEdit: params.isLiveEdit,
                sourceMapURL: params.sourceMapURL,
                hasSourceURL: params.hasSourceURL,
                isModule: params.isModule,
                length: params.length,
                script: await this._scriptsRegistry.getScriptByCdtpId(params.scriptId)
            });
    }
}

abstract class ScriptCreator {
    protected readonly runtimeSourcePath = parseResourceIdentifier(createCDTPScriptUrl(this._scriptParsedEvent.url || ''));

    constructor(
        private readonly _scriptsRegistry: CDTPScriptsRegistry,
        protected readonly _loadedSourcesRegistry: LoadedSourcesRegistry,
        protected readonly _pathTransformer: BasePathTransformer,
        private readonly _sourceMapTransformer: BaseSourceMapTransformer,
        protected readonly _scriptParsedEvent: CDTP.Debugger.ScriptParsedEvent,
    ) { }

    public async createAndRegisterScript(): Promise<IScript> {
        const executionContext = this._scriptsRegistry.getExecutionContextById(this._scriptParsedEvent.executionContextId);

        const script = await this._scriptsRegistry.registerScript(this._scriptParsedEvent.scriptId, async () => {
            const sourceMap = await this.sourceMap();
            const sourceMapperProvider = script => this.sourceMapper(script, sourceMap);
            const mappedSourcesProvider = script => this.mappedSources(sourceMapperProvider(script));

            return this.createScript(executionContext, sourceMapperProvider, mappedSourcesProvider);
        });

        script.mappedSources.forEach(source =>
            this._loadedSourcesRegistry.registerRelationship(source, new MappedSourceOf(source, script)));

        await this.registerRuntimeAndDevelopmentSourcesRelationships(script);

        return script;
    }

    private sourceMap(): Promise<SourceMap> {
        return this._sourceMapTransformer.scriptParsed(this.runtimeSourcePath.canonicalized, this._scriptParsedEvent.sourceMapURL);
    }

    protected abstract createScript(executionContext: IExecutionContext, sourceMapperProvider: (script: IScript) => IMappedSourcesMapper,
        mappedSourcesProvider: (script: IScript) => IdentifiedLoadedSource<string>[]): Promise<IScript>;

    protected abstract registerRuntimeAndDevelopmentSourcesRelationships(script: IScript): Promise<void>;

    private mappedSources(sourceMapper: IMappedSourcesMapper): IdentifiedLoadedSource[] {
        return sourceMapper.sources.map((path: string) => this.obtainLoadedSource(parseResourceIdentifier(path), SourceScriptRelationship.Unknown));
    }

    private sourceMapper(script: IScript, sourceMap: SourceMap): IMappedSourcesMapper {
        const sourceMapper = sourceMap
            ? new MappedSourcesMapper(script, sourceMap)
            : new NoMappedSourcesMapper(script);
        return sourceMapper;
    }

    protected scriptRange(runtimeSource: ILoadedSource<CDTPScriptUrl>) {
        const startPosition = new Position(createLineNumber(this._scriptParsedEvent.startLine), createColumnNumber(this._scriptParsedEvent.startColumn));
        const endPosition = new Position(createLineNumber(this._scriptParsedEvent.endLine), createColumnNumber(this._scriptParsedEvent.endColumn));
        const scriptRange = new RangeInResource(runtimeSource, startPosition, endPosition);
        return scriptRange;
    }

    protected obtainLoadedSource(sourceUrl: IResourceIdentifier, sourceScriptRelationship: SourceScriptRelationship): IdentifiedLoadedSource {
        return this._loadedSourcesRegistry.getOrAdd(sourceUrl, provider => {
            return IdentifiedLoadedSource.create(sourceUrl, sourceScriptRelationship, provider);
        });
    }
}

class IdentifiedScriptCreator extends ScriptCreator {
    private readonly runtimeSource = _.memoize(() => this.obtainRuntimeSource());
    private readonly developmentSource = _.memoize(() => this.obtainDevelopmentSource());

    protected async createScript(executionContext: IExecutionContext, sourceMapperProvider: (script: IScript) => IMappedSourcesMapper,
        mappedSourcesProvider: (script: IScript) => IdentifiedLoadedSource<string>[]): Promise<IScript> {
        return Script.create(executionContext, this.runtimeSource(), await this.developmentSource(), sourceMapperProvider, mappedSourcesProvider, this.scriptRange(this.runtimeSource()));
    }

    private obtainRuntimeSource(): IdentifiedLoadedSource<CDTPScriptUrl> {
        // This is an heuristic. I think that if the script starts on (0, 0) then that means the file is a script file, and not an .html file or something which is a script and something else
        // I cannot think of any case where this would be false, but we've been surprised before...
        const isSingleScript = this._scriptParsedEvent.startLine === 0 && this._scriptParsedEvent.startColumn === 0;
        const sourceScriptRelationship = isSingleScript ? SourceScriptRelationship.SourceIsSingleScript : SourceScriptRelationship.SourceIsMoreThanAScript;

        // TODO: Figure out a way to remove the cast in next line
        return <IdentifiedLoadedSource<CDTPScriptUrl>><unknown>this.obtainLoadedSource(this.runtimeSourcePath, sourceScriptRelationship);
    }

    private async obtainDevelopmentSource(): Promise<IdentifiedLoadedSource> {
        // TODO: Remove .textRepresentation and use resource identifier instead
        const developmentSourceLocation = await this._pathTransformer.scriptParsed(this.runtimeSourcePath.textRepresentation);

        // The development file should have the same contents, so it should have the same source script relationship as the runtime file
        return this.obtainLoadedSource(parseResourceIdentifier(developmentSourceLocation), this.runtimeSource().sourceScriptRelationship);
    }

    protected async registerRuntimeAndDevelopmentSourcesRelationships(script: IScript): Promise<void> {
        const developmentSource = await this.developmentSource();
        this._loadedSourcesRegistry.registerRelationship(developmentSource, new DevelopmentSourceOf(developmentSource, this.runtimeSource(), script));

        const runtimeSource = await this.runtimeSource();
        this._loadedSourcesRegistry.registerRelationship(runtimeSource, new RuntimeSourceOf(runtimeSource, script));
    }
}

class UnidentifiedScriptCreator extends ScriptCreator {
    protected async createScript(executionContext: IExecutionContext, sourceMapperProvider: (script: IScript) => IMappedSourcesMapper,
        mappedSourcesProvider: (script: IScript) => IdentifiedLoadedSource<string>[]): Promise<IScript> {
        return Script.createWithUnidentifiedSource(new ResourceName(createCDTPScriptUrl(`${this._scriptParsedEvent.scriptId}`)),
            executionContext, sourceMapperProvider, mappedSourcesProvider, (runtimeSource: ILoadedSource<CDTPScriptUrl>) => this.scriptRange(runtimeSource));
    }

    protected async registerRuntimeAndDevelopmentSourcesRelationships(_script: IScript): Promise<void> { }
}
