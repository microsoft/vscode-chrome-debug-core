import { BPRecipeInSource } from './bpRecipeInSource';
import { BreakpointInSource } from './breakpoint';
import { LocationInLoadedSource } from '../locations/location';

const ImplementsBPRecipeSingleLocationStatus = Symbol();
export interface IBPRecipeSingleLocationStatus {
    [ImplementsBPRecipeSingleLocationStatus]: string;

    isVerified(): boolean;
}

export class BPRecipeIsUnbound implements IBPRecipeSingleLocationStatus {
    [ImplementsBPRecipeSingleLocationStatus] = 'IBPRecipeSingleLocationStatus';

    constructor(
        public readonly recipe: BPRecipeInSource,
        public readonly error: Error) {
    }

    public isVerified(): boolean {
        return false;
    }

    public toString(): string {
        // `The JavaScript code associated with this source file hasn't been loaded into the debuggee yet`
        return `${this.recipe} is unbound because ${this.error}`;
    }
}

export class BPRecipeIsBoundInRuntimeLocation implements IBPRecipeSingleLocationStatus {
    [ImplementsBPRecipeSingleLocationStatus] = 'IBPRecipeSingleLocationStatus';

    constructor(
        public readonly recipe: BPRecipeInSource,
        public readonly locationInRuntimeSource: LocationInLoadedSource,
        public readonly breakpoints: BreakpointInSource[]) {
        if (this.breakpoints.length === 0) {
            throw new Error(`At least a single breakpoint was expected`);
        }
    }

    public isVerified(): boolean {
        return true;
    }

    public toString(): string {
        return `${this.recipe} is bound at ${this.locationInRuntimeSource} with ${this.breakpoints.join(', ')}`;
    }
}
