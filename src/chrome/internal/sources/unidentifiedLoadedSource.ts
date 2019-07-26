/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IScript } from '../scripts/script';
import { CDTPScriptUrl } from './resourceIdentifierSubtypes';
import { IResourceIdentifier, parseResourceIdentifier, ResourceName } from './resourceIdentifier';
import { ILoadedSource, IScriptMapper, SourceScriptRelationship, ImplementsLoadedSource, ScriptAndSourceMapper, ContentsLocation } from './loadedSource';
import { ILoadedSourceToScriptRelationship, UnmappedSourceOf } from './loadedSourceToScriptRelationship';
import { UnmappedSourceMapper } from '../scripts/sourcesMapper';
import { LocationInLoadedSource, LocationInScript } from '../locations/location';
import { IMappedTokensInScript, MappedTokensInScript } from '../locations/mappedTokensInScript';
import { InternalError } from '../../utils/internalError';

export class UnidentifiedLoadedSource implements ILoadedSource<CDTPScriptUrl> {
    // TODO DIEGO: Move these two properties to the client layer
    public static EVAL_FILENAME_PREFIX = 'VM';
    public static EVAL_PSEUDO_FOLDER = '<eval>';
    public static EVAL_PSEUDO_PREFIX = `${UnidentifiedLoadedSource.EVAL_PSEUDO_FOLDER}\\${UnidentifiedLoadedSource.EVAL_FILENAME_PREFIX}`;

    public [ImplementsLoadedSource]: 'ILoadedSource' = 'ILoadedSource';

    public contentsLocation = ContentsLocation.PersistentStorage;

    public readonly sourceScriptRelationship = SourceScriptRelationship.SourceIsSingleScript;

    constructor(public readonly script: IScript, public readonly name: ResourceName<CDTPScriptUrl>, public readonly origin: string) { }

    public get url(): never {
        throw new InternalError('error.unidentifiedLoadedSource.cantGetUrl', `Can't get the url for ${this} because it doesn't have one`);
    }

    public get identifier(): IResourceIdentifier<CDTPScriptUrl> {
        return parseResourceIdentifier<CDTPScriptUrl>(`${UnidentifiedLoadedSource.EVAL_PSEUDO_PREFIX}${this.name.textRepresentation}` as any);
    }

    public isMappedSource(): boolean {
        return false;
    }

    public doesScriptHasUrl(): boolean {
        return false;
    }

    public scriptMapper(): IScriptMapper {
        return new CurrentUnidentifiedSourceScriptRelationships(this, this.script);
    }

    public isEquivalentTo(source: UnidentifiedLoadedSource): boolean {
        return this === source;
    }

    public toString(): string {
        return `No URL script source with id: ${this.name}`;
    }
}

export class CurrentUnidentifiedSourceScriptRelationships implements IScriptMapper {
    constructor(private readonly _source: UnidentifiedLoadedSource, private readonly _script: IScript) { }

    public mapToScripts(position: LocationInLoadedSource): IMappedTokensInScript<IScript>[] {
        return [MappedTokensInScript.characterAt(new LocationInScript(this._script, position.position))];
    }

    public get relationships(): ILoadedSourceToScriptRelationship[] {
        const unmappedSourceRelationship = new UnmappedSourceOf(this._source, this._source.script);
        return [unmappedSourceRelationship];
    }

    public get scriptsAndSourceMappers(): ScriptAndSourceMapper[] {
        return [new ScriptAndSourceMapper(this._source.script, new UnmappedSourceMapper(this._source.script, this._source))];
    }

    public get scripts(): IScript[] {
        return [this._source.script];
    }

    public toString(): string {
        return `This unidentified source is it's own runtime and development script`;
    }
}
