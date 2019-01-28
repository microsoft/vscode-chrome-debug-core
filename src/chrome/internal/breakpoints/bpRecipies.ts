/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from '../sources/loadedSource';
import { ISource } from '../sources/source';
import { BPRecipie } from './bpRecipie';
import { printArray } from '../../collections/printing';
import { IResourceIdentifier } from '../sources/resourceIdentifier';

/**
 * These classes are used to handle all the set of breakpoints for a single file as a unit, and be able to resolve them all together
 */
export class BaseBPRecipies<TResource extends ILoadedSource | ISource> {
    constructor(public readonly source: TResource, public readonly breakpoints: BPRecipie<TResource>[]) {
        this.breakpoints.forEach(breakpoint => {
            const bpResource: TResource = breakpoint.location.resource;
            if (!(<any>bpResource).isEquivalentTo(this.source)) { // TODO: Figure out a way to remove this any
                throw new Error(`Expected all the breakpoints to have source ${source} yet the breakpoint ${breakpoint} had ${bpResource} as it's source`);
            }
        });
    }

    public toString(): string {
        return printArray(`BPs @ ${this.source}`, this.breakpoints);
    }
}

export class BPRecipiesInSource extends BaseBPRecipies<ISource> {
    public tryResolving<R>(ifSuccesfulDo: (bpsInLoadedSource: BPRecipiesInLoadedSource) => R, ifFaileDo: () => R): R {
        return this.source.tryResolving(
            loadedSource => {
                const loadedSourceBPs = this.breakpoints.map(breakpoint => breakpoint.resolvedWithLoadedSource(loadedSource));
                return ifSuccesfulDo(new BPRecipiesInLoadedSource(loadedSource, loadedSourceBPs));
            },
            ifFaileDo);
    }

    public get requestedSourcePath(): IResourceIdentifier {
        return this.source.sourceIdentifier;
    }
}

export class BPRecipiesInLoadedSource extends BaseBPRecipies<ILoadedSource> { }