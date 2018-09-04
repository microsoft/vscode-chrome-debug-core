import { IResourceIdentifier } from './resourceIdentifier';
import { ILoadedSource } from './loadedSource';
import { SourceResolverLogic } from './sourceResolverLogic';

export interface ISourceResolver {
    readonly sourceIdentifier: IResourceIdentifier;
    isEquivalent(right: ISourceResolver): boolean;
    tryResolving<R>(whenSuccesfulDo: (resolvedSource: ILoadedSource) => R, whenFailedDo: (sourceIdentifier: IResourceIdentifier) => R): R;
}

abstract class DoesResolveToSameSourceCommonLogic implements ISourceResolver {
    public abstract tryResolving<R>(whenSuccesfulDo: (loadedSource: ILoadedSource) => R, whenFailedDo: (identifier: IResourceIdentifier) => R): R;
    public abstract get sourceIdentifier(): IResourceIdentifier;

    public isEquivalent(right: ISourceResolver): boolean {
        return this.sourceIdentifier.isEquivalent(right.sourceIdentifier);
    }
}

// Find the source to resolve to by using the path
export class ResolveSourceUsingPath extends DoesResolveToSameSourceCommonLogic implements ISourceResolver {
    public tryResolving<R>(whenSuccesfulDo: (resolvedSource: ILoadedSource) => R, whenFailedDo: (sourceIdentifier: IResourceIdentifier) => R) {
        return this._sourceManager.tryResolving(this.sourceIdentifier, whenSuccesfulDo, whenFailedDo);
    }

    public toString(): string {
        return `Resolve source using #${this.sourceIdentifier}`;
    }

    constructor(public readonly sourceIdentifier: IResourceIdentifier, private readonly _sourceManager: SourceResolverLogic) {
        super();
    }
}

export class ResolveSourceUsingLoadedSource extends DoesResolveToSameSourceCommonLogic implements ISourceResolver {
    public tryResolving<R>(whenSuccesfulDo: (resolvedSource: ILoadedSource) => R, _whenFailedDo: (sourceIdentifier: IResourceIdentifier) => R) {
        return whenSuccesfulDo(this.loadedSource);
    }

    public get sourceIdentifier(): IResourceIdentifier {
        return this.loadedSource.identifier;
    }

    public toString(): string {
        return `${this.loadedSource}`;
    }

    constructor(public readonly loadedSource: ILoadedSource) {
        super();
    }
}
