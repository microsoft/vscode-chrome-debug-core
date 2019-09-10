/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';

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
import { LocalizedError, registerGetLocalize } from '../../utils/localization';

let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());
import { SourceContents } from './sourceContents';

export interface IPossiblyRetrievableText {
    isRetrievable: boolean;

    retrieve(): Promise<SourceContents>;
}

export class RetrievableText implements IPossiblyRetrievableText {
    public readonly isRetrievable = true;

    public constructor(public readonly retrieve: () => Promise<SourceContents>) { }
}

export class NonRetrievableText implements IPossiblyRetrievableText {
    public readonly isRetrievable = false;

    public constructor(public readonly retrieve: () => never) { }
}

export interface ISourceTextRetriever {
    text(source: ILoadedSource): Promise<SourceContents>;
    retrievability(source: ILoadedSource): IPossiblyRetrievableText;
}

/**
 * Retrieves the text associated with a loaded source that maps to a JavaScript script file
 * (If the loaded source maps to an .html file or something different than a single script, a different class/API will need to be used)
 */
@injectable()
export class SourceTextRetriever implements ISourceTextRetriever {
    private _sourceToText = new ValidatedMap<ILoadedSource, Promise<SourceContents>>();

    constructor(@inject(TYPES.IScriptSources) private readonly _scriptSources: IScriptSourcesRetriever,
        @inject(TYPES.GetSourceTextRetrievability) private readonly _retrievability: GetSourceTextRetrievability) {}

    // We want this method to add an entry to the map this._sourceToText atomically, so if we get 2 simultaneous calls,
    // the second call will return the promise/result of the first call
    public text(loadedSource: ILoadedSource): Promise<SourceContents> {
        let text = this._sourceToText.tryGetting(loadedSource);

        if (text === undefined) {
            const sourceRetrievability = this._retrievability(this._scriptSources, loadedSource);
            text = sourceRetrievability.retrieve();
            this._sourceToText.set(loadedSource, text);
        }

        return text;
    }

    public retrievability(source: ILoadedSource): IPossiblyRetrievableText {
        return this._retrievability(this._scriptSources, source);
    }

    public toString(): string {
        return `Sources text logic\n${printIterable('sources in cache', this._sourceToText.keys())}`;
    }
}

export type GetSourceTextRetrievability = (scriptSources: IScriptSourcesRetriever, loadedSource: ILoadedSource) => IPossiblyRetrievableText;

// We use the retrievability instead of the text method to figure out if a loadedSource that we'll send to the client
// is retrievable, and thus, if it should include a sourceReference in it or not
export function getSourceTextRetrievability(scriptSources: IScriptSourcesRetriever, loadedSource: ILoadedSource): IPossiblyRetrievableText {
    const scripts = loadedSource.scriptMapper().scripts;
    if (loadedSource.sourceScriptRelationship === SourceScriptRelationship.SourceIsSingleScript && scripts.length === 1) {
        const singleScript = singleElementOfArray(scripts);
        return new RetrievableText(() => scriptSources.getScriptSource(singleScript));
    } else if (loadedSource.sourceScriptRelationship === SourceScriptRelationship.SourceIsSingleScript && scripts.length >= 2) {
        /**
         * We have two or more scripts associated with this source. At the moment we don't have any further support for this scenario
         * so we just return the source of the first script. This won't be ideal if for some reason the source of both scripts
         * isn't the same.
         */
        return new RetrievableText(() => {
            logger.warn(`${loadedSource} is associated with several ${printArray('scripts', scripts)} returning arbitrarily the source of the first one`);
            const singleScript = scripts[0];
                return scriptSources.getScriptSource(singleScript);
        });
    } else if (loadedSource.contentsLocation === ContentsLocation.PersistentStorage) {
        // If this is a file, we don't want to cache it, so we return the contents immediately
        return new RetrievableText(() => utils.readFileP(loadedSource.identifier.textRepresentation));
    } else {
        logger.error(`Unexpected source relationship: ${loadedSource} sourceScriptRelationship = ${loadedSource.sourceScriptRelationship}. #scripts = ${scripts.length}`);

        // We'll need to figure out what is the right thing to do for SourceScriptRelationship.Unknown
        return new NonRetrievableText(() => {
            throw new LocalizedError('error.sourceText.multipleScriptsNotSupported', localize('error.sourceText.multipleScriptsNotSupported',
                "Support for getting the text from dynamic sources that have multiple scripts embedded hasn't been implemented yet"));
        });
    }
}
