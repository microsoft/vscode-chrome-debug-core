/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from './loadedSource';
import { ISource, SourceToBeResolvedViaPath } from './source';
import { newResourceIdentifierMap, IResourceIdentifier } from './resourceIdentifier';
import { injectable, inject } from 'inversify';

import { IScriptParsedProvider } from '../../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';
import { TYPES } from '../../dependencyInjection.ts/types';

/**
 * The SourceResolver listens to onScriptParsed events to build a map of paths to loaded sources. When an SourceToBeResolvedViaPath is created, it'll store a reference to this object,
 * and use it when it tries to resolve the path to a loaded source
 */

@injectable()
export class SourceResolver {
    private _pathToSource = newResourceIdentifierMap<ILoadedSource>();

    constructor(
        @inject(TYPES.IScriptParsedProvider) public readonly _cdtpOnScriptParsedEventProvider: IScriptParsedProvider) {
        this._cdtpOnScriptParsedEventProvider.onScriptParsed(async params => {
            params.script.allSources.forEach(source => {
                // The same file can be loaded as a script twice, and different scripts can share the same mapped source, so we ignore exact duplicates
                this._pathToSource.setAndIgnoreDuplicates(source.identifier, source, (left, right) => left.isEquivalentTo(right));
            });
        });
    }

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
}
