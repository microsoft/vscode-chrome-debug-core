/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource, ILoadedSourceTreeNode, determineOrderingOfLoadedSources } from './loadedSource';
import { IScript } from '../scripts/script';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { CDTPScriptsRegistry } from '../../cdtpDebuggee/registries/cdtpScriptsRegistry';

/**
 * Provides a list of all the sources associated with scripts currently loaded in a tree format
 */
@injectable()
export class LoadedSourcesTreeRetriever {
    constructor(@inject(TYPES.CDTPScriptsRegistry) private readonly _cdtpScriptsRegistry: CDTPScriptsRegistry) { }

    /*
    We create a tree like:
    + RuntimeSource_1
    + RuntimeSource_2
        - Source of Compiled_2_a
        - Source of Compiled_2_b
    */
    // TODO: Verify if this is the format we should use for the tree
    public async getLoadedSourcesTrees(): Promise<ILoadedSourceTreeNode[]> {
        const scripts = await Promise.all(Array.from(await this._cdtpScriptsRegistry.getAllScripts()));
        const sourceMetadataTree = scripts.map(script => this.getLoadedSourcesTreeForScript(script));
        return sourceMetadataTree;
    }

    public getLoadedSourcesTreeForScript(script: IScript): ILoadedSourceTreeNode {
        const sortedSourcesOfCompiled = script.mappedSources.sort(determineOrderingOfLoadedSources);
        return this.toTreeNode(script.runtimeSource, this.toTreeNodes(sortedSourcesOfCompiled));
    }

    private toTreeNodes(sources: ILoadedSource[]): ILoadedSourceTreeNode[] {
        return sources.map(source => this.toTreeNode(source, []));
    }

    private toTreeNode(source: ILoadedSource, relatedSources: ILoadedSourceTreeNode[] = []): ILoadedSourceTreeNode {
        // TODO DIEGO: MAKE ORIGIN WORK
        // const origin = [this._chromeDebugAdapter.getReadonlyOrigin(source.script.runtimeSource.identifier.textRepresentation)];
        return { mainSource: source, relatedSources: relatedSources };
    }
}