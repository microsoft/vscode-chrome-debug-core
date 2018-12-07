import { ILoadedSource } from './loadedSource';
import { ISourceResolver, ResolveSourceUsingPath } from './sourceResolver';
import { newResourceIdentifierMap, IResourceIdentifier } from './resourceIdentifier';
import { IComponent } from '../features/feature';
import { ScriptParsedEvent } from '../../target/events';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface EventsConsumedBySourceResolverLogic {
    onScriptParsed(listener: (scriptEvent: ScriptParsedEvent) => Promise<void>): void;
}

@injectable()
export class SourceResolverLogic implements IComponent {
    private _pathToSource = newResourceIdentifierMap<ILoadedSource>();

    public tryResolving<R>(sourceIdentifier: IResourceIdentifier,
        whenSuccesfulDo: (resolvedSource: ILoadedSource) => R,
        whenFailedDo: (sourceIdentifier: IResourceIdentifier) => R = path => { throw new Error(`Couldn't find the source at path ${path}`); }): R {
        const source = this._pathToSource.tryGetting(sourceIdentifier);
        if (source !== undefined) {
            return whenSuccesfulDo(source);
        } else {
            return whenFailedDo(sourceIdentifier);
        }
    }

    public createSourceResolver(sourceIdentifier: IResourceIdentifier): ISourceResolver {
        return new ResolveSourceUsingPath(sourceIdentifier, this);
    }

    public toString(): string {
        return `Source resolver logic { path to source: ${this._pathToSource} }`;
    }

    public install(): this {
        this._dependencies.onScriptParsed(async params => {
            params.script.allSources.forEach(source => {
                this._pathToSource.set(source.identifier, source);
            });
        });

        return this;
    }

    constructor(
        @inject(TYPES.EventsConsumedByConnectedCDA) private readonly _dependencies: EventsConsumedBySourceResolverLogic) { }
}