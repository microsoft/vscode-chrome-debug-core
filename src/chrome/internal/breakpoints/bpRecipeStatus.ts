/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IBPRecipe } from './bpRecipe';
import { LocationInLoadedSource } from '../locations/location';
import { IBreakpoint } from './breakpoint';
import { printArray } from '../../collections/printing';
import { ISource } from '../sources/source';

/** These interface and classes represent the status of a BP Recipe (Is it bound or not?) */
export interface IBPRecipeStatus {
    readonly recipe: IBPRecipe<ISource>;
    readonly statusDescription: string;

    isVerified(): boolean;
}

export class BPRecipeIsUnbound implements IBPRecipeStatus {
    public isVerified(): boolean {
        return false;
    }

    public toString(): string {
        return `${this.recipe} is unbound because ${this.statusDescription}`;
    }

    constructor(
        public readonly recipe: IBPRecipe<ISource>,
        public readonly statusDescription: string) {
    }
}

export class BPRecipeIsBound implements IBPRecipeStatus {
    public get actualLocationInSource(): LocationInLoadedSource {
        // TODO: Figure out what is the right way to decide the actual location when we have multiple breakpoints
        return this.breakpoints[0].actualLocation;
    }

    public isVerified(): boolean {
        return true;
    }

    public toString(): string {
        return `${this.recipe} is bound with all ${printArray('', this.breakpoints)} because ${this.statusDescription}`;
    }

    constructor(
        public readonly recipe: IBPRecipe<ISource>,
        public readonly breakpoints: IBreakpoint<ISource>[],
        public readonly statusDescription: string) {
        if (this.breakpoints.length === 0) {
            throw new Error(`A breakpoint recipe that is bound needs to have at least one breakpoint that was bound for the recipe yet ${this} had none`);
        }
    }
}
