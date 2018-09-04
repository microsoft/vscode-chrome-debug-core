export type NamespaceTree<T> = { [name: string]: NamespaceTree<T> | T };

export class NamespaceReverseLookupCreator<T> {
    private readonly _leafToNameMapping = new Map<T, string>();

    constructor(
        private readonly _root: NamespaceTree<T>,
        private readonly _isLeaf: (node: NamespaceTree<T> | T) => node is T,
        private readonly _namesPrefix: string) { }

    public create(): Map<T, string> {
        this.exploreLeaf(this._root, this._namesPrefix);
        return this._leafToNameMapping;
    }

    private exploreLeaf(currentRoot: NamespaceTree<T>, namePrefix: string): void {
        for (const propertyNamme in currentRoot) {
            const propertyName = namePrefix ? `${namePrefix}.${propertyNamme}` : propertyNamme;
            const propertyValue = currentRoot[propertyNamme];
            if (this._isLeaf(propertyValue)) {
                this._leafToNameMapping.set(propertyValue as T, propertyName);
            } else {
                this.exploreLeaf(propertyValue, propertyName);
            }
        }
    }
}