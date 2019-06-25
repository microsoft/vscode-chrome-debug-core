import { ILoadedSource } from '../sources/loadedSource';
import { IdentifiedLoadedSource } from '../sources/identifiedLoadedSource';
import { UnidentifiedLoadedSource } from '../sources/unidentifiedLoadedSource';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { IValidatedMap } from '../../collections/validatedMap';
import { printArray } from '../../collections/printing';
import { ISourceMapper } from './sourcesMapper';
import { IResourceIdentifier, newResourceIdentifierMap, ResourceName } from '../sources/resourceIdentifier';
import { IExecutionContext } from './executionContext';
import { IEquivalenceComparable } from '../../utils/equivalence';
import { RangeInResource } from '../locations/rangeInScript';
import * as _ from 'lodash';
import { IHasSourceMappingInformation } from './IHasSourceMappingInformation';
import { Position } from '../locations/location';

/**
 * Multiplicity:
 *   Scripts N [HTMLFile or MultipleTimesLoaded] ... 1 RuntimeSource(LoadedSource)(URLs)
 *   RuntimeSource(LoadedSource)(URLs) N ... 1 DevelopmentSource(LoadedSource)
 *   DevelopmentSource(LoadedSource) N ... M MappedSource(LoadedSource)
 *
 * --- Details ---
 * Scripts N [HTMLFile or MultipleTimesLoaded] ... 1 RuntimeSource(LoadedSource)(URLs)
 *   RuntimeSource(LoadedSource)(URLs) can have N Scripts if it's an .html file with multiple scripts or multiple event handlers
 *   RuntimeSource(LoadedSource)(URLs) can have N Scripts if the same script was loaded multiple times (We've seen this happen in Node when the require cache is deleted)
 *
 * RuntimeSource(LoadedSource)(URLs) N ... 1 DevelopmentSource(LoadedSource)
 * DevelopmentSource(LoadedSource) can be associated with multiple RuntimeSource(LoadedSource)(URLs) if the web-server severs the same file from multiple URLs
 *
 * DevelopmentSource(LoadedSource) N ... M MappedSource(LoadedSource)
 * DevelopmentSource(LoadedSource) can be associated with multiple MappedSource(LoadedSource) if files were bundled or compiled with TypeScript bundling option
 * MappedSource(LoadedSource) can be associated with multiple DevelopmentSource(LoadedSource) if the same typescript file gets bundled into different javascript files
 *
 * Additional notes:
 * It's extremelly unlikely, but it's possible for a .js file to be the MappedSource of a Script A, the RuntimeSource of a different script B, and the DevelopmentSource for a different script C
 */

/**
 * This interface represents a piece of code that is being executed in the debuggee. Usually a script matches to a file or a url, but that is not always the case.
 * This interface solves the problem of finding the different loaded sources associated with a script, and being able to identify and compare both scripts and sources easily.
 */
const ImplementsScript = Symbol();
export interface IScript extends IEquivalenceComparable, IHasSourceMappingInformation {
    [ImplementsScript]: string;

    readonly executionContext: IExecutionContext;
    readonly runtimeSource: ILoadedSource<CDTPScriptUrl>; // Source in Webserver

    readonly developmentSource: ILoadedSource; // Source in Workspace
    readonly allSources: ILoadedSource[]; // runtimeSource + developmentSource + mappedSources
    readonly url: CDTPScriptUrl;

    readonly sourceMapper: ISourceMapper<IScript>;

    getSource(sourceIdentifier: IResourceIdentifier): ILoadedSource;

    isEquivalentTo(script: IScript): boolean;
}

export function isScript(object: unknown): object is IScript {
    return !!(<any>object)[ImplementsScript];
}

export class Script implements IScript {
    public [ImplementsScript] = 'IScript';

    private readonly _compiledSources: IValidatedMap<IResourceIdentifier, IdentifiedLoadedSource>;
    public readonly runtimeSource: ILoadedSource<CDTPScriptUrl>;
    public readonly rangeInSource: RangeInResource<ILoadedSource<CDTPScriptUrl>>;
    public readonly developmentSource: ILoadedSource;
    public readonly sourceMapper: ISourceMapper<IScript>;

    constructor(public readonly executionContext: IExecutionContext, runtimeSourceProvider: (script: IScript) => ILoadedSource<CDTPScriptUrl>, developmentSourceProvider: (script: IScript) => ILoadedSource,
        mappedSourcesProvider: (script: IScript) => IdentifiedLoadedSource[], sourceMapperProvider: (script: IScript) => ISourceMapper<IScript>,
        rangeInSourceProvider: (runtimeSource: ILoadedSource<CDTPScriptUrl>) => RangeInResource<ILoadedSource<CDTPScriptUrl>>) {
        this.runtimeSource = runtimeSourceProvider(this);
        this.developmentSource = developmentSourceProvider(this);
        this.rangeInSource = rangeInSourceProvider(this.runtimeSource);
        this.sourceMapper = sourceMapperProvider(this);
        const pathsAndMappedSources = mappedSourcesProvider(this).map(mappedSource => [mappedSource.identifier, mappedSource] as [IResourceIdentifier, IdentifiedLoadedSource]);
        this._compiledSources = newResourceIdentifierMap(pathsAndMappedSources);
    }

    public static create(executionContext: IExecutionContext, runtimeSource: ILoadedSource<CDTPScriptUrl>, developmentSource: ILoadedSource,
        sourcesMapperProvider: (script: IScript) => ISourceMapper<IScript>, mappedSourcesProvider: (script: IScript) => IdentifiedLoadedSource[], rangeInSource: RangeInResource<ILoadedSource<CDTPScriptUrl>>): Script {
        return new Script(executionContext, () => runtimeSource, () => developmentSource, mappedSourcesProvider, sourcesMapperProvider, () => rangeInSource);
    }

    public static createWithUnidentifiedSource(name: ResourceName<CDTPScriptUrl>, executionContext: IExecutionContext, sourcesMapperProvider: (script: IScript) => ISourceMapper<IScript>,
        mappedSourcesProvider: (script: IScript) => IdentifiedLoadedSource[], rangeInSource: (runtimeSource: ILoadedSource<CDTPScriptUrl>) => RangeInResource<ILoadedSource<CDTPScriptUrl>>): Script {

        // We use memoize to ensure that the function returns always the same instance for the same script, so the runtime source and the development source will be the same object/identity
        const sourceProvider = _.memoize((script: IScript) => new UnidentifiedLoadedSource(script, name, "source for the script from the debugging engine, because the script doesn't have an url"));
        return new Script(executionContext, sourceProvider, sourceProvider, mappedSourcesProvider, sourcesMapperProvider, rangeInSource);
    }

    public get mappedSources(): IdentifiedLoadedSource[] {
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

        return unmappedSources.concat(this.mappedSources);
    }

    public get url(): CDTPScriptUrl {
        return this.runtimeSource.identifier.textRepresentation;
    }

    public get startPositionInSource(): Position {
        return this.rangeInSource.start.position;
    }

    public isEquivalentTo(script: Script): boolean {
        return this === script;
    }

    public toDetailedString(): string {
        return `Script(${this.runtimeSource} or ${this.developmentSource}) ${printArray(' --> ', this.mappedSources)}`;
    }

    public toString(): string {
        return `${this.runtimeSource}` + (!this.rangeInSource.start.position.isOrigin() ? `<${this.rangeInSource.start.position}>` : ``);
    }
}
