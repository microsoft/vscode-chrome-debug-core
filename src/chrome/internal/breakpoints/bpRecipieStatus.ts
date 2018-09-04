import { IBPRecipie } from './bpRecipie';

import { ILoadedSource } from '../sources/loadedSource';

import { ScriptOrSourceOrIdentifierOrUrlRegexp, LocationInLoadedSource } from '../locations/location';

import { IBreakpoint } from './breakpoint';
import { printArray } from '../../collections/printting';

export interface IBPRecipieStatus {
    readonly statusDescription: string;
    readonly recipie: IBPRecipie<ILoadedSource>;

    isVerified(): boolean;
    isBinded(): this is BPRecipieIsBinded;
}

export class BPRecipieIsUnbinded implements IBPRecipieStatus {
    public isBinded(): this is BPRecipieIsBinded {
        return false;
    }

    public isVerified(): boolean {
        return false;
    }

    public toString(): string {
        return `${this.recipie} is unbinded because ${this.statusDescription}`;
    }

    constructor(
        public readonly recipie: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>,
        public readonly statusDescription: string) {
    }
}

export class BPRecipieIsBinded implements IBPRecipieStatus {
    public isBinded(): this is BPRecipieIsBinded {
        return true;
    }

    public get actualLocationInSource(): LocationInLoadedSource {
        // TODO: Figure out what is the right way to decide the actual location when we have multiple breakpoints
        return this.breakpoints[0].actualLocation.asLocationInLoadedSource();
    }

    public isVerified(): boolean {
        return true;
    }

    public toString(): string {
        return `${this.recipie} is binded with all ${printArray('', this.breakpoints)} because ${this.statusDescription}`;
    }

    constructor(
        public readonly recipie: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>,
        public readonly breakpoints: IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>[],
        public readonly statusDescription: string) {
        if (this.breakpoints.length === 0) {
            throw new Error(`A breakpoint recipie that is binded needs to have at least one breakpoint that was binded for the recipie yet ${this} had none`);
        }
    }
}
