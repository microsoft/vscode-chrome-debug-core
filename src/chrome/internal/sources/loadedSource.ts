import { IScript } from '../scripts/script';
import { CDTPScriptUrl } from './resourceIdentifierSubtypes';
import { IResourceIdentifier, parseResourceIdentifier, ResourceName } from './resourceIdentifier';
import { determineOrderingOfStrings } from '../../collections/utilities';

export interface ILoadedSource<TString = string> {
    readonly script: IScript;
    readonly identifier: IResourceIdentifier<TString>;
    readonly origin: string;
    doesScriptHasUrl(): boolean; // TODO DIEGO: Figure out if we can delete this property
    isSourceOfCompiled(): boolean;
    isEquivalent(source: ILoadedSource<TString>): boolean;
}

/**
 * Loaded Source classification:
 * Is the script content available on a single place, or two places? (e.g.: You can find similar scripts in multiple different paths)
 *  1. Single: Is the single place on storage, or is this a dynamic script?
 *      Single path on storage: RuntimeScriptRunFromStorage
 *      Single path not on storage: DynamicRuntimeScript
 *  2. Two: We assume one path is from the webserver, and the other path is in the workspace: RuntimeScriptWithSourceOnWorkspace
 */

abstract class LoadedSourceWithURLCommonLogic<TSource = string> implements ILoadedSource<TSource> {
    public isSourceOfCompiled(): boolean {
        return false;
    }

    public doesScriptHasUrl(): boolean {
        return true;
    }

    public isEquivalent(source: ILoadedSource<TSource>): boolean {
        return this === source;
    }

    public toString(): string {
        return `src:${this.identifier}`;
    }

    constructor(
        public readonly script: IScript,
        public readonly identifier: IResourceIdentifier<TSource>,
        public readonly origin: string) { }
}

export class ScriptRunFromLocalStorage extends LoadedSourceWithURLCommonLogic<CDTPScriptUrl> implements ILoadedSource<CDTPScriptUrl> { }
export class DynamicScript extends LoadedSourceWithURLCommonLogic<CDTPScriptUrl> implements ILoadedSource<CDTPScriptUrl> { }
export class ScriptRuntimeSource extends LoadedSourceWithURLCommonLogic<CDTPScriptUrl> implements ILoadedSource<CDTPScriptUrl> { }
export class ScriptDevelopmentSource extends LoadedSourceWithURLCommonLogic implements ILoadedSource { }

export class NoURLScriptSource implements ILoadedSource<CDTPScriptUrl> {
    public get identifier(): IResourceIdentifier<CDTPScriptUrl> {
        return parseResourceIdentifier<CDTPScriptUrl>(`${NoURLScriptSource.EVAL_PSEUDO_PREFIX}${this.name.textRepresentation}` as any);
    }

    // TODO DIEGO: Move these two properties to the client layer
    public static EVAL_FILENAME_PREFIX = 'VM';
    public static EVAL_PSEUDO_FOLDER = '<eval>';
    public static EVAL_PSEUDO_PREFIX = `${NoURLScriptSource.EVAL_PSEUDO_FOLDER}\\${NoURLScriptSource.EVAL_FILENAME_PREFIX}`;

    public isSourceOfCompiled(): boolean {
        return false;
    }

    public doesScriptHasUrl(): boolean {
        return false;
    }

    public isEquivalent(source: NoURLScriptSource): boolean {
        return this === source;
    }

    public toString(): string {
        return `No URL script source with id: ${this.name}`;
    }

    constructor(
        public readonly script: IScript,
        public readonly name: ResourceName<CDTPScriptUrl>,
        public readonly origin: string) { }
}

// This represents a path to a development source that was compiled to generate the runtime code of the script
export class SourceOfCompiled extends LoadedSourceWithURLCommonLogic implements ILoadedSource {
    public isSourceOfCompiled(): boolean {
        return true;
    }
}

export interface ILoadedSourceTreeNode {
    readonly mainSource: ILoadedSource;
    readonly relatedSources: ILoadedSourceTreeNode[];
}

export function determineOrderingOfLoadedSources(left: ILoadedSource, right: ILoadedSource): number {
    return determineOrderingOfStrings(left.identifier.canonicalized, right.identifier.canonicalized);
}