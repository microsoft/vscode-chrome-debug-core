/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from './loadedSource';
import { ISource, SourceToBeResolvedViaPath } from './source';
import { newResourceIdentifierMap, IResourceIdentifier } from './resourceIdentifier';
import { injectable, inject } from 'inversify';

import { IScriptParsedProvider } from '../../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IExecutionContextEventsProvider } from '../../cdtpDebuggee/eventsProviders/cdtpExecutionContextEventsProvider';

/**
 * The SourceResolver listens to onScriptParsed events to build a map of paths to loaded sources. When an SourceToBeResolvedViaPath is created, it'll store a reference to this object,
 * and use it when it tries to resolve the path to a loaded source
 */

@injectable()
export class SourceResolver {
    private _pathToSource = newResourceIdentifierMap<ILoadedSource>();

    constructor(
        @inject(TYPES.IScriptParsedProvider) public readonly _cdtpOnScriptParsedEventProvider: IScriptParsedProvider,
        @inject(TYPES.ExecutionContextEventsProvider) public readonly _executionContextEventsProvider: IExecutionContextEventsProvider) {
        this._cdtpOnScriptParsedEventProvider.onScriptParsed(async params => {
            // We check to see if the script is destroyed, to avoid a race condition of adding a script after it's destroyed.
            if (!params.script.executionContext.isDestroyed()) {
                // Warning: We still have a small chance of having a race condition if we get an onScriptParsed, we get an onExecutionContextsCleared, we get another
                // onScriptParsed for the same script id, and then we process the two onScriptParsed events before processing the onExecutionContextsCleared
                // event. If that happens, we'll need to update the code to execute those two events always in the proper relative order.
                params.script.allSources.forEach(source => {
                    // The same file can be loaded as a script twice, and different scripts can share the same mapped source, so we ignore exact duplicates
                    this._pathToSource.setAndIgnoreDuplicates(source.identifier, source, (left, right) => left.isEquivalentTo(right));
                });
            }
        });
        this._executionContextEventsProvider.onExecutionContextsCleared(() => {
            // After the context is cleared the script ids can be reused, so we need to empty our cache
            this._pathToSource.clear();
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
