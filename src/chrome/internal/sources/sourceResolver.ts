/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from './loadedSource';
import { ISource, SourceToBeResolvedViaPath } from './source';
import { newResourceIdentifierMap, IResourceIdentifier } from './resourceIdentifier';
import { IComponent } from '../features/feature';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IScript } from '../scripts/script';

// TODO: Remove next line and use the import instead
interface IScriptParsedEvent {
    readonly script: IScript;
}
// import { IScriptParsedEvent } from '../../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';

export interface IEventsConsumedBySourceResolver {
    onScriptParsed(listener: (scriptEvent: IScriptParsedEvent) => Promise<void>): void;
}

/**
 * The SourceResolver listens to onScriptParsed events to build a map of paths to loaded sources. When an SourceToBeResolvedViaPath is created, it'll store a reference to this object,
 * and use it when it tries to resolve the path to a loaded source
 */

 @injectable()
export class SourceResolver implements IComponent {
    private _pathToSource = newResourceIdentifierMap<ILoadedSource>();

    public tryResolving<R>(sourceIdentifier: IResourceIdentifier,
        succesfulAction: (resolvedSource: ILoadedSource) => R,
        failedAction: (sourceIdentifier: IResourceIdentifier) => R): R {
        const source = this._pathToSource.tryGetting(sourceIdentifier);
        if (source !== undefined) {
            return succesfulAction(source);
        } else {
            return failedAction(sourceIdentifier);
        }
    }

    public createUnresolvedSource(sourceIdentifier: IResourceIdentifier): ISource {
        return new SourceToBeResolvedViaPath(sourceIdentifier, this);
    }

    public toString(): string {
        return `Source resolver { path to source: ${this._pathToSource} }`;
    }

    public install(): this {
        this._dependencies.onScriptParsed(async params => {
            params.script.allSources.forEach(source => {
                // The same file can be loaded as a script twice, and different scripts can share the same mapped source, so we ignore exact duplicates
                this._pathToSource.setAndIgnoreDuplicates(source.identifier, source, (left, right) => left.isEquivalentTo(right));
            });
        });

        return this;
    }

    constructor(
        @inject(TYPES.EventsConsumedByConnectedCDA) private readonly _dependencies: IEventsConsumedBySourceResolver) { }
}
