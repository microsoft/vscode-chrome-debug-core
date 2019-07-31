/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { ILoadedSource, ContentsLocation, SourceScriptRelationship } from './loadedSource';
import { ValidatedMap } from '../../collections/validatedMap';
import { printIterable } from '../../collections/printing';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IScriptSourcesRetriever } from '../../cdtpDebuggee/features/cdtpScriptSourcesRetriever';
import { singleElementOfArray } from '../../collections/utilities';
import * as utils from '../../../utils';
import { logger } from 'vscode-debugadapter';
import { printArray } from '../../collections/printing';

/**
 * Retrieves the text associated with a loaded source that maps to a JavaScript script file
 * (If the loaded source maps to an .html file or something different than a single script, a different class/API will need to be used)
 */
@injectable()
export class SourceTextRetriever {
    private _sourceToText = new ValidatedMap<ILoadedSource, Promise<string>>();

    constructor(@inject(TYPES.IScriptSources) private readonly _scriptSources: IScriptSourcesRetriever) { }

    // We want this method to add an entry to the map this._sourceToText atomically, so if we get 2 simultaneous calls,
    // the second call will return the promise/result of the first call
    public text(loadedSource: ILoadedSource): Promise<string> {
        let text = this._sourceToText.tryGetting(loadedSource);

        if (text === undefined) {
            const scripts = loadedSource.scriptMapper().scripts;
            if (loadedSource.sourceScriptRelationship === SourceScriptRelationship.SourceIsSingleScript && scripts.length === 1) {
                text = this._scriptSources.getScriptSource(singleElementOfArray(scripts));
            } else if (loadedSource.sourceScriptRelationship === SourceScriptRelationship.SourceIsSingleScript && scripts.length >= 2) {
                /**
                 * We have two scripts associated with this source. At the moment we don't have any further support for this scenario
                 * so we just return the source of the first script. This won't be ideal if for some reason the source of both scripts
                 * isn't the same.
                 */
                logger.warn(`${loadedSource} is associated with several ${printArray('scripts', scripts)} returning the source arbitrarily of the first one`);
                text = this._scriptSources.getScriptSource(scripts[0]);
            } else if (loadedSource.contentsLocation === ContentsLocation.PersistentStorage) {
                // If this is a file, we don't want to cache it, so we return the contents immediately
                return utils.readFileP(loadedSource.identifier.textRepresentation);
            } else {
                // We'll need to figure out what is the right thing to do for SourceScriptRelationship.Unknown
                throw new Error(localize('error.sourceText.multipleScriptsNotSupported', "Support for getting the text from dynamic sources that have multiple scripts embedded hasn't been implemented yet"));
            }
            this._sourceToText.set(loadedSource, text);
        }

        return text;
    }

    public toString(): string {
        return `Sources text logic\n${printIterable('sources in cache', this._sourceToText.keys())}`;
    }
}