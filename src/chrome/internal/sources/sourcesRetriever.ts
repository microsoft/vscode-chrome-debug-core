/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IPossiblyRetrievableText, ISourceTextRetriever } from './sourceTextRetriever';
import { LoadedSourcesTreeRetriever } from './loadedSourcesTreeRetriever';
import { ILoadedSourceTreeNode, ILoadedSource } from './loadedSource';
import { ISource } from './source';
import { IScript } from '../scripts/script';
import { injectable, inject } from 'inversify';
import { InternalError } from '../../utils/internalError';
import { SourceContents } from './sourceContents';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface ISourcesRetriever {
    loadedSourcesTrees(): Promise<ILoadedSourceTreeNode[]>;
    loadedSourcesTreeForScript(script: IScript): ILoadedSourceTreeNode;
    text(source: ISource): Promise<SourceContents>;
    retrievability(loadedSource: ILoadedSource): IPossiblyRetrievableText;
}

@injectable()
export class SourcesRetriever implements ISourcesRetriever {
    constructor(
        @inject(TYPES.ISourceTextRetriever) private readonly _sourceTextRetriever: ISourceTextRetriever,
        private readonly _sourceTreeNodeLogic: LoadedSourcesTreeRetriever) {
    }

    public async loadedSourcesTrees(): Promise<ILoadedSourceTreeNode[]> {
        return this._sourceTreeNodeLogic.getLoadedSourcesTrees();
    }

    public loadedSourcesTreeForScript(script: IScript): ILoadedSourceTreeNode {
        return this._sourceTreeNodeLogic.getLoadedSourcesTreeForScript(script);
    }

    public async text(source: ISource): Promise<SourceContents> {
        return await source.tryResolving(
            async loadedSource => await this._sourceTextRetriever.text(loadedSource),
            identifier => {
                throw new InternalError('error.source.cantResolve', `Couldn't resolve the source with the path: ${identifier.textRepresentation}`);
            });
    }

    public retrievability(loadedSource: ILoadedSource): IPossiblyRetrievableText {
        return this._sourceTextRetriever.retrievability(loadedSource);
    }

    public toString(): string {
        return `Sources retriever for text:\n${this._sourceTextRetriever}\n for trees:\n${this._sourceTreeNodeLogic}\n}`;
    }
}