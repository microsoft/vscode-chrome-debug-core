import { BPRecipeInSource } from './bpRecipeInSource';
import { BreakpointInSource } from './breakpoint';
import { LocationInLoadedSource } from '../locations/location';

const ImplementsBPRecipeSingleLocationStatus = Symbol();
export interface IBPRecipeSingleLocationStatus {
    [ImplementsBPRecipeSingleLocationStatus]: string;

    isVerified(): boolean;
}

export class BPRecipeIsUnboundInRuntimeLocation implements IBPRecipeSingleLocationStatus {
    [ImplementsBPRecipeSingleLocationStatus] = 'IBPRecipeSingleLocationStatus';

    public isVerified(): boolean {
        return false;
    }

    public toString(): string {
        // `The JavaScript code associated with this source file hasn't been loaded into the debuggee yet`
        return `${this.recipe} at ${this.locationInRuntimeSource} is unbound because ${this.error}`;
    }

    constructor(
        public readonly recipe: BPRecipeInSource,
        public readonly locationInRuntimeSource: LocationInLoadedSource,
        public readonly error: Error) {
    }
}

export class BPRecipeIsBoundInRuntimeLocation implements IBPRecipeSingleLocationStatus {
    [ImplementsBPRecipeSingleLocationStatus] = 'IBPRecipeSingleLocationStatus';

    public isVerified(): boolean {
        return true;
    }

    public toString(): string {
        return `${this.recipe} is bound at ${this.locationInRuntimeSource} with ${this.breakpoints.join(', ')}`;
    }

    constructor(
        public readonly recipe: BPRecipeInSource,
        public readonly locationInRuntimeSource: LocationInLoadedSource,
        public readonly breakpoints: BreakpointInSource[]) {
        if (this.breakpoints.length === 0) {
            throw new Error(`At least a single breakpoint was expected`);
        }
    }
}
