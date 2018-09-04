import * as fs from 'fs';
import {
    ILoadedSource, SourceOfCompiled, ScriptRunFromLocalStorage, DynamicScript,
    ScriptRuntimeSource, ScriptDevelopmentSource, NoURLScriptSource
} from '../sources/loadedSource';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { IValidatedMap } from '../../collections/validatedMap';
import { printArray } from '../../collections/printting';
import { ISourcesMapper } from './sourcesMapper';
import { IResourceIdentifier, IResourceLocation, newResourceIdentifierMap, parseResourceIdentifier, ResourceName } from '../sources/resourceIdentifier';
import { IExecutionContext } from './executionContext';

export interface IScript {
    readonly executionContext: IExecutionContext;
    readonly runtimeSource: ILoadedSource<CDTPScriptUrl>; // Source in Webserver
    readonly developmentSource: ILoadedSource; // Source in Workspace
    readonly sourcesOfCompiled: SourceOfCompiled[]; // Sources before compilation
    readonly allSources: ILoadedSource[]; // runtimeSource + developmentSource + sourcesOfCompiled
    readonly url: CDTPScriptUrl;

    readonly sourcesMapper: ISourcesMapper; // TODO DIEGO: See if we can delete this property

    getSource(sourceIdentifier: IResourceIdentifier): ILoadedSource;

    isEquivalent(source: IScript): boolean;
}

export class Script implements IScript {
    private readonly _runtimeSource: ILoadedSource<CDTPScriptUrl>;
    private readonly _developmentSource: ILoadedSource;
    private readonly _compiledSources: IValidatedMap<IResourceIdentifier, SourceOfCompiled>;

    public static create(executionContext: IExecutionContext, locationInRuntimeEnvironment: IResourceLocation<CDTPScriptUrl>, locationInDevelopmentEnvinronment: IResourceLocation,
        sourcesMapper: ISourcesMapper): Script {
        const sourcesOfCompiled = (script: IScript) => newResourceIdentifierMap<SourceOfCompiled>(sourcesMapper.sources.map(path => {
            const identifier = parseResourceIdentifier(path);
            return [identifier, new SourceOfCompiled(script, identifier, 'TODO DIEGO')] as [IResourceIdentifier, SourceOfCompiled];
        }));

        /**
         * Loaded Source classification:
         * Is the script content available on a single place, or two places? (e.g.: You can find similar scripts in multiple different paths)
         *  1. Single: Is the single place on the user workspace, or is this a dynamic script?
         *      Single path on storage: RuntimeScriptRunFromStorage
         *      Single path not on storage: DynamicRuntimeScript
         *  2. Two: We assume one path is from the webserver, and the other path is in the workspace: RuntimeScriptWithSourceOnWorkspace
         */
        let runtimeSource: (script: IScript) => ILoadedSource<CDTPScriptUrl>;
        let developmentSource: (script: IScript) => ILoadedSource;
        if (locationInRuntimeEnvironment.isEquivalent(locationInDevelopmentEnvinronment) || locationInDevelopmentEnvinronment.textRepresentation === '') {
            if (fs.existsSync(locationInRuntimeEnvironment.textRepresentation)) {
                developmentSource = runtimeSource = script => new ScriptRunFromLocalStorage(script, locationInRuntimeEnvironment, 'TODO DIEGO');
            } else {
                developmentSource = runtimeSource = script => new DynamicScript(script, locationInRuntimeEnvironment, 'TODO DIEGO');
            }
        } else {
            // The script is served from one location, and it's on the workspace on a different location
            runtimeSource = script => new ScriptRuntimeSource(script, locationInRuntimeEnvironment, 'TODO DIEGO');
            developmentSource = script => new ScriptDevelopmentSource(script, locationInDevelopmentEnvinronment, 'TODO DIEGO');
        }
        return new Script(executionContext, runtimeSource, developmentSource, sourcesOfCompiled, sourcesMapper);
    }

    public static createEval(executionContext: IExecutionContext, name: ResourceName<CDTPScriptUrl>, sourcesMapper: ISourcesMapper): Script {
        // TODO DIEGO Return the same instance both functions
        const getNoURLScript = (script: IScript) => new NoURLScriptSource(script, name, 'TODO DIEGO');
        return new Script(executionContext, getNoURLScript, getNoURLScript, _ => new Map<IResourceIdentifier, SourceOfCompiled>(), sourcesMapper);
    }

    constructor(public readonly executionContext: IExecutionContext, getRuntimeSource: (script: IScript) => ILoadedSource<CDTPScriptUrl>, getDevelopmentSource: (script: IScript) => ILoadedSource,
        getCompiledScriptSources: (script: IScript) => Map<IResourceIdentifier, SourceOfCompiled>, public readonly sourcesMapper: ISourcesMapper) {
        this._runtimeSource = getRuntimeSource(this);
        this._developmentSource = getDevelopmentSource(this);
        this._compiledSources = newResourceIdentifierMap(getCompiledScriptSources(this));
    }

    public get developmentSource(): ILoadedSource {
        return this._developmentSource;
    }

    public get runtimeSource(): ILoadedSource<CDTPScriptUrl> {
        return this._runtimeSource;
    }

    public get sourcesOfCompiled(): SourceOfCompiled[] {
        return Array.from(this._compiledSources.values());
    }

    public getSource(sourceIdentifier: IResourceIdentifier): ILoadedSource {
        return this._compiledSources.get(sourceIdentifier);
    }

    public get allSources(): ILoadedSource[] {
        const unmappedSources: ILoadedSource[] = [this.runtimeSource];
        if (this.developmentSource !== this.runtimeSource) {
            unmappedSources.push(this.developmentSource);
        }

        return unmappedSources.concat(this.sourcesOfCompiled);
    }

    public get url(): CDTPScriptUrl {
        return this._runtimeSource.identifier.textRepresentation;
    }

    public isEquivalent(script: Script): boolean {
        return this === script;
    }

    public toString(): string {
        return `Script:\n  Runtime source: ${this.runtimeSource}\n  Development source: ${this.developmentSource}\n`
            + printArray('  Sources of compiledsource', this.sourcesOfCompiled);
    }
}
