import { newResourceIdentifierMap, IResourceIdentifier } from '../../internal/sources/resourceIdentifier';
import { ICurrentScriptRelationshipsProvider, IScriptMapper } from '../../internal/sources/loadedSource';
import { IdentifiedLoadedSource, ScriptMapper } from '../../internal/sources/identifiedLoadedSource';
import { CDTPScriptUrl } from '../../internal/sources/resourceIdentifierSubtypes';
import { ValidatedMultiMap } from '../../collections/validatedMultiMap';
import { ILoadedSourceToScriptRelationship } from '../../internal/sources/loadedSourceToScriptRelationship';
import { injectable } from 'inversify';

@injectable()
export class LoadedSourcesRegistry implements ICurrentScriptRelationshipsProvider {
    // TODO: Figure out a way to store IdentifiedLoadedSource<CDTPScriptUrl> and IdentifiedLoadedSource<string> in a single map while preserving type safety
    private readonly _loadedSourceByPath = newResourceIdentifierMap<IdentifiedLoadedSource>();

    private readonly _loadedSourceToCurrentScriptRelationships = new ValidatedMultiMap<IdentifiedLoadedSource, ILoadedSourceToScriptRelationship>();

    public getOrAdd(pathOrUrl: IResourceIdentifier,
        obtainValueToAdd: (provider: ICurrentScriptRelationshipsProvider) => IdentifiedLoadedSource): IdentifiedLoadedSource {
        // TODO: The casts in this method are actually false sometimes (Although they won't cause any issues at runtime). Figure out a way of doing this with type safety
        const url = <IResourceIdentifier<CDTPScriptUrl>><unknown>pathOrUrl;
        return <IdentifiedLoadedSource>this._loadedSourceByPath.getOrAdd(url, () => {
            const newLoadedSource = obtainValueToAdd(this);
            this._loadedSourceToCurrentScriptRelationships.addKeyIfNotExistant(newLoadedSource);
            return newLoadedSource;
        });
    }

    public registerRelationship(loadedSource: IdentifiedLoadedSource, relationship: ILoadedSourceToScriptRelationship) {
        this._loadedSourceToCurrentScriptRelationships.add(loadedSource, relationship);
    }

    public scriptMapper(loadedSource: IdentifiedLoadedSource<string>): IScriptMapper {
        return new ScriptMapper(Array.from(this._loadedSourceToCurrentScriptRelationships.get(loadedSource)));
    }

    public toString(): string {
        return `Loaded sources: ${this._loadedSourceByPath}\nRelationships:\n${this._loadedSourceToCurrentScriptRelationships}`;
    }
}