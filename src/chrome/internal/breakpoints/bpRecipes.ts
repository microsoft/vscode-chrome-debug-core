/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from '../sources/loadedSource';
import { ISource } from '../sources/source';
import { BPRecipe } from './bpRecipe';
import { printArray } from '../../collections/printing';
import { IResourceIdentifier } from '../sources/resourceIdentifier';
import { InternalError } from '../../utils/internalError';

/**
 * These classes are used to handle all the set of breakpoints for a single file as a unit, and be able to resolve them all together
 */
export class BaseBPRecipes<TResource extends ILoadedSource | ISource> {
    constructor(public readonly source: TResource, public readonly breakpoints: BPRecipe<TResource>[]) {
        this.breakpoints.forEach(breakpoint => {
            const bpResource: TResource = breakpoint.location.resource;
            if (!(<any>bpResource).isEquivalentTo(this.source)) { // TODO: Figure out a way to remove this any
                throw new InternalError('error.bpRecipes.incompatibleSource', `Expected all the breakpoints to have source ${source} yet the breakpoint ${breakpoint} had ${bpResource} as it's source`);
            }
        });
    }

    public toString(): string {
        return printArray(`BPs @ ${this.source}`, this.breakpoints.map(bp => `line ${bp.location.position} do: ${bp.bpActionWhenHit}`));
    }
}

export class BPRecipesInSource extends BaseBPRecipes<ISource> {
    public tryResolving<R>(succesfulAction: (bpsInLoadedSource: BPRecipesInLoadedSource) => R, failedAction: () => R): R {
        return this.source.tryResolving(
            loadedSource => {
                const loadedSourceBPs = this.breakpoints.map(breakpoint => breakpoint.resolvedWithLoadedSource(loadedSource));
                return succesfulAction(new BPRecipesInLoadedSource(loadedSource, loadedSourceBPs));
            },
            failedAction);
    }

    public get requestedSourcePath(): IResourceIdentifier {
        return this.source.sourceIdentifier;
    }
}

export class BPRecipesInLoadedSource extends BaseBPRecipes<ILoadedSource> { }