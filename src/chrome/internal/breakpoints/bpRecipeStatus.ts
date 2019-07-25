/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { LocationInLoadedSource } from '../locations/location';
import { printArray } from '../../collections/printing';
import { BPRecipeIsBoundInRuntimeLocation, BPRecipeIsUnbound } from './bpRecipeStatusForRuntimeLocation';
import { BPRecipeInSource } from './bpRecipeInSource';
import { breakWhileDebugging } from '../../../validation';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

/** These interface and classes represent the status of a BP Recipe (Is it bound or not?) */
export const ImplementsBPRecipeStatus = Symbol();
export interface IBPRecipeStatus {
    [ImplementsBPRecipeStatus]: string;

    readonly recipe: BPRecipeInSource;
    readonly statusDescription: string;

    isVerified(): boolean;
    ifHasActualLocation<T>(ifHasAction: (actualLocation: LocationInLoadedSource) => T, ifDoesNotHaveAction: () => T): T;
}

export class BPRecipeIsUnboundDueToNoSubstatuses implements IBPRecipeStatus {
    [ImplementsBPRecipeStatus] = 'IBPRecipeStatus';

    constructor(
        public readonly recipe: BPRecipeInSource) {
    }

    public isVerified(): boolean {
        return false;
    }

    public get statusDescription(): string {
        return localize('breakpointStatus.noScriptBoundToSource', 'unbound because none of the scripts already loaded are associated with this source');
    }

    public ifHasActualLocation<T>(_ifHasAction: (actualLocation: LocationInLoadedSource) => T, ifDoesNotHaveAction: () => T): T {
        return ifDoesNotHaveAction();
    }

    public toString(): string {
        return `${this.recipe} is ${this.statusDescription}`;
    }
}

export class BPRecipeHasBoundSubstatuses implements IBPRecipeStatus {
    [ImplementsBPRecipeStatus] = 'IBPRecipeStatus';

    constructor(
        public readonly recipe: BPRecipeInSource,
        public readonly boundSubstatuses: BPRecipeIsBoundInRuntimeLocation[],
        public readonly unboundSubstatuses: BPRecipeIsUnbound[]) {
        if (this.boundSubstatuses.length === 0) {
            breakWhileDebugging();
            throw new Error(localize('error.breakpointStatus.expectedAtLeastOneBoundSubstatus', 'At least one bound substatus was expected'));
        }
    }

    public get actualLocationInSource(): LocationInLoadedSource {
        // TODO: Figure out what is the right way to decide the actual location when we have multiple breakpoints
        return this.boundSubstatuses[0].breakpoints[0].actualLocation;
    }

    public isVerified(): boolean {
        return true;
    }

    public get statusDescription(): string {
        return localize('breakpointStatus.substatusesPrefix', 'bound with ') + printArray('', this.boundSubstatuses);
    }

    public ifHasActualLocation<T>(ifHasAction: (actualLocation: LocationInLoadedSource) => T, _ifDoesNotHaveAction: () => T): T {
        return ifHasAction(this.actualLocationInSource);
    }

    public toString(): string {
        return `${this.recipe} is ${this.statusDescription}`;
    }
}

export class BPRecipeHasOnlyUnboundSubstatuses implements IBPRecipeStatus {
    [ImplementsBPRecipeStatus] = 'IBPRecipeStatus';

    constructor(
        public readonly recipe: BPRecipeInSource,
        public readonly unboundSubstatuses: BPRecipeIsUnbound[]) {
        if (this.unboundSubstatuses.length === 0) {
            breakWhileDebugging();
            throw new Error(localize('error.breakpointStatus.expectedAtLeastOneUnboundSubstatus', 'At least the substatus for a single runtime source was expected'));
        }
    }

    public isVerified(): boolean {
        return true;
    }

    public get statusDescription(): string {
        return localize('breakpointStatus.unboundReasonPrefix', 'unbound because ') + printArray('', this.unboundSubstatuses);
    }

    public ifHasActualLocation<T>(_ifHasAction: (actualLocation: LocationInLoadedSource) => T, ifDoesNotHaveAction: () => T): T {
        return ifDoesNotHaveAction();
    }

    public toString(): string {
        return `${this.recipe} is ${this.statusDescription}`;
    }
}

export function createBPRecipieStatus(recipe: BPRecipeInSource, boundSubstatuses: BPRecipeIsBoundInRuntimeLocation[], unboundSubstatuses: BPRecipeIsUnbound[]): IBPRecipeStatus {
    if (boundSubstatuses.length > 0) {
        return new BPRecipeHasBoundSubstatuses(recipe, boundSubstatuses, unboundSubstatuses);
    } else if (unboundSubstatuses.length > 0) {
        return new BPRecipeHasOnlyUnboundSubstatuses(recipe, unboundSubstatuses);
    } else {
        return new BPRecipeIsUnboundDueToNoSubstatuses(recipe);
    }
}
