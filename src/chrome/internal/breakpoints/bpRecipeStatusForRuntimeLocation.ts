/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BPRecipeInSource } from './bpRecipeInSource';
import { BreakpointInSource } from './breakpoint';
import { LocationInLoadedSource } from '../locations/location';
import { InternalError } from '../../utils/internalError';

import * as nls from 'vscode-nls';
import { registerGetLocalize } from '../../utils/localization';
let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

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
        return localize('bpRecipeStatus.unbound.description', '{0} is unbound because {1}', this.recipe.toString(), this.error.message);
    }
}

export class BPRecipeIsBoundInRuntimeLocation implements IBPRecipeSingleLocationStatus {
    [ImplementsBPRecipeSingleLocationStatus] = 'IBPRecipeSingleLocationStatus';

    constructor(
        public readonly recipe: BPRecipeInSource,
        public readonly locationInRuntimeSource: LocationInLoadedSource,
        public readonly breakpoints: BreakpointInSource[]) {
        if (this.breakpoints.length === 0) {
            throw new InternalError('error.bpRecipeStatus.boundInRuntime.invalid', 'At least a single breakpoint was expected');
        }
    }

    public isVerified(): boolean {
        return true;
    }

    public toString(): string {
        return localize('bpRecipeStatus.boundInRuntime.description', '{0} is bound at {1} with {2}',
            this.recipe.toString(), this.locationInRuntimeSource.toString(), this.breakpoints.join(localize('breakpoint.listSeparator', ', ')));
    }
}
