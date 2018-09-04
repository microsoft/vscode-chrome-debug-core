import { ILoadedSource, ILoadedSourceTreeNode, determineOrderingOfLoadedSources } from './loadedSource';
import { IScript } from '../scripts/script';
import { IComponent } from '../features/feature';
import { injectable } from 'inversify';

export interface SourcesTreeNodeLogicDependencies {
    allScripts(): Promise<IScript[]>;
}

@injectable()
export class SourcesTreeNodeLogic implements IComponent {
    /*
    We create a tree like:
    + RuntimeSource_1
    + RuntimeSource_2
        - Source of Compiled_2_a
        - Source of Compiled_2_b
    */
    // TODO DIEGO: Verify if this is the format we should use for the tree
    public async getLoadedSourcesTrees(): Promise<ILoadedSourceTreeNode[]> {
        const scripts = await Promise.all(Array.from(await this._dependencies.allScripts()));
        const sourceMetadataTree = scripts.map(script => this.getLoadedSourcesTreeForScript(script));
        return sourceMetadataTree;
    }

    public getLoadedSourcesTreeForScript(script: IScript): ILoadedSourceTreeNode {
        const sortedSourcesOfCompiled = script.sourcesOfCompiled.sort(determineOrderingOfLoadedSources);
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

    public install(): this {
        return this;
    }

    constructor(private readonly _dependencies: SourcesTreeNodeLogicDependencies) { }
}