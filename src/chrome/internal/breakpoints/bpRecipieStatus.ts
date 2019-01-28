/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IBPRecipie } from './bpRecipie';
import { LocationInLoadedSource } from '../locations/location';
import { IBreakpoint } from './breakpoint';
import { printArray } from '../../collections/printing';
import { ISource } from '../sources/source';

/** These interface and classes represent the status of a BP Recipie (Is it binded or not?) */
export interface IBPRecipieStatus {
    readonly recipie: IBPRecipie<ISource>;
    readonly statusDescription: string;

    isVerified(): boolean;
}

export class BPRecipieIsUnbinded implements IBPRecipieStatus {
    public isVerified(): boolean {
        return false;
    }

    public toString(): string {
        return `${this.recipie} is unbinded because ${this.statusDescription}`;
    }

    constructor(
        public readonly recipie: IBPRecipie<ISource>,
        public readonly statusDescription: string) {
    }
}

export class BPRecipieIsBinded implements IBPRecipieStatus {
    public get actualLocationInSource(): LocationInLoadedSource {
        // TODO: Figure out what is the right way to decide the actual location when we have multiple breakpoints
        return this.breakpoints[0].actualLocation;
    }

    public isVerified(): boolean {
        return true;
    }

    public toString(): string {
        return `${this.recipie} is binded with all ${printArray('', this.breakpoints)} because ${this.statusDescription}`;
    }

    constructor(
        public readonly recipie: IBPRecipie<ISource>,
        public readonly breakpoints: IBreakpoint<ISource>[],
        public readonly statusDescription: string) {
        if (this.breakpoints.length === 0) {
            throw new Error(`A breakpoint recipie that is binded needs to have at least one breakpoint that was binded for the recipie yet ${this} had none`);
        }
    }
}
