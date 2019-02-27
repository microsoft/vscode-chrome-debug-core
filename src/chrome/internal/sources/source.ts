/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IResourceIdentifier } from './resourceIdentifier';
import { ILoadedSource } from './loadedSource';
import { SourceResolver } from './sourceResolver';
import { IEquivalenceComparable } from '../../utils/equivalence';

/**
 * VS Code debug protocol sends breakpoint requests with a path?: string; or sourceReference?: number; Before we can use the path, we need to wait for the related script to be loaded so we can match it with a script id.
 * This set of classes will let us represent the information we get from either a path or a sourceReference, and then let us try to resolve it to a script id when possible.
 */
const ImplementsSource = Symbol();
export interface ISource extends IEquivalenceComparable {
    [ImplementsSource]: string;

    readonly sourceIdentifier: IResourceIdentifier;
    tryResolving<R>(succesfulAction: (resolvedSource: ILoadedSource) => R, failedAction: (sourceIdentifier: IResourceIdentifier) => R): R;

    isEquivalentTo(right: ISource): boolean;
}

export function isSource(object: unknown): object is ISource {
    return !!(<any>object)[ImplementsSource];
}

abstract class BaseSource implements ISource {
    [ImplementsSource]: 'ISource';

    public abstract tryResolving<R>(succesfulAction: (loadedSource: ILoadedSource) => R, failedAction: (identifier: IResourceIdentifier) => R): R;
    public abstract get sourceIdentifier(): IResourceIdentifier;

    public isEquivalentTo(right: ISource): boolean {
        return this.sourceIdentifier.isEquivalentTo(right.sourceIdentifier);
    }
}

// Find the related source by using the source's path
export class SourceToBeResolvedViaPath extends BaseSource implements ISource {
    public tryResolving<R>(succesfulAction: (resolvedSource: ILoadedSource) => R, failedAction: (sourceIdentifier: IResourceIdentifier) => R) {
        return this._sourceResolver.tryResolving(this.sourceIdentifier, succesfulAction, failedAction);
    }

    public toString(): string {
        return `${this.sourceIdentifier}`;
    }

    constructor(public readonly sourceIdentifier: IResourceIdentifier, private readonly _sourceResolver: SourceResolver) {
        super();
    }
}

// This source was already loaded, so we store it in this class
export class SourceAlreadyResolvedToLoadedSource extends BaseSource implements ISource {
    public tryResolving<R>(succesfulAction: (resolvedSource: ILoadedSource) => R, _failedAction: (sourceIdentifier: IResourceIdentifier) => R) {
        return succesfulAction(this.loadedSource);
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
