/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { ILoadedSource } from '../sources/loadedSource';
import { ISource } from '../sources/source';
import { BPRecipe } from './bpRecipe';
import { printArray } from '../../collections/printing';
import { IResourceIdentifier } from '../sources/resourceIdentifier';

/**
 * These classes are used to handle all the set of breakpoints for a single file as a unit, and be able to resolve them all together
 */
export class BaseBPRecipes<TResource extends ILoadedSource | ISource> {
    constructor(public readonly source: TResource, public readonly breakpoints: BPRecipe<TResource>[]) {
        this.breakpoints.forEach(breakpoint => {
            const bpResource: TResource = breakpoint.location.resource;
            if (!(<any>bpResource).isEquivalentTo(this.source)) { // TODO: Figure out a way to remove this any
                throw new Error(localize('error.bpRecipes.incompatibleSource', "Expected all the breakpoints to have source {0} yet the breakpoint {1} had {2} as it's source", `${source}`, breakpoint.toString(), `${bpResource}`));
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