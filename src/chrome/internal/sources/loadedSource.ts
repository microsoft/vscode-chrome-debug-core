/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IScript } from '../scripts/script';
import { IResourceIdentifier } from './resourceIdentifier';
import { determineOrderingOfStrings } from '../../collections/utilities';
import { IEquivalenceComparable } from '../../utils/equivalence';
import { IdentifiedLoadedSource } from './identifiedLoadedSource';
import { ISourceMapper } from '../scripts/sourcesMapper';
import { LocationInScript, LocationInLoadedSource } from '../locations/location';

/**
 * This interface represents a source or text that is related to a script that the debuggee is executing. The text can be the contents of the script itself,
 *  or a file from which the script was loaded, or a file that was compiled to generate the contents of the script
 */
export const ImplementsLoadedSource = Symbol();
export interface ILoadedSource<TString = string> extends IEquivalenceComparable {
    [ImplementsLoadedSource]: 'ILoadedSource';

    readonly identifier: IResourceIdentifier<TString>;
    readonly url: TString;
    readonly sourceScriptRelationship: SourceScriptRelationship;
    readonly contentsLocation: ContentsLocation;

    // readonly origin: string;
    doesScriptHasUrl(): boolean; // TODO DIEGO: Figure out if we can delete this property
    isMappedSource(): boolean;

    scriptMapper(): IScriptMapper;
}

/**
 * Loaded Source classification:
 * Is the script content available on a single place, or two places? (e.g.: You can find similar scripts in multiple different paths)
 *  1. Single: Is the single place on storage, or is this a dynamic script?
 *      Single path on storage: RuntimeScriptRunFromStorage
 *      Single path not on storage: DynamicRuntimeScript
 *  2. Two: We assume one path is from the webserver, and the other path is in the workspace: RuntimeScriptWithSourceOnWorkspace
 */
export interface ICurrentScriptRelationshipsProvider {
    scriptMapper(loadedSource: IdentifiedLoadedSource): IScriptMapper;
}

export class ScriptAndSourceMapper {
    constructor(
        public readonly script: IScript,
        public readonly sourcesMapper: ISourceMapper) { }
}

export interface IScriptMapper {
    readonly scripts: IScript[];
    mapToScripts(position: LocationInLoadedSource): LocationInScript[];
}

export enum SourceScriptRelationship {
    SourceIsSingleScript,
    SourceIsMoreThanAScript,
    Unknown
}

export function isLoadedSource(object: unknown): object is ILoadedSource {
    return !!(<any>object)[ImplementsLoadedSource];
}

export enum ContentsLocation {
    DynamicMemory,
    PersistentStorage
}

export interface ILoadedSourceTreeNode {
    readonly mainSource: ILoadedSource;
    readonly relatedSources: ILoadedSourceTreeNode[];
}

export function determineOrderingOfLoadedSources(left: ILoadedSource, right: ILoadedSource): number {
    return determineOrderingOfStrings(left.identifier.canonicalized, right.identifier.canonicalized);
}
