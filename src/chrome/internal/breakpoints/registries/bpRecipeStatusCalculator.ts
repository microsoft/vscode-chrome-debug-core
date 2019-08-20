/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { createBPRecipieStatus, IBPRecipeStatus } from '../bpRecipeStatus';
import { LocationInLoadedSource } from '../../locations/location';
import { ValidatedMap, IValidatedMap } from '../../../collections/validatedMap';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { BPRecipeIsUnbound, BPRecipeIsBoundInRuntimeLocation } from '../bpRecipeStatusForRuntimeLocation';
import { printMap } from '../../../collections/printing';
import { ValidatedMultiMap } from '../../../collections/validatedMultiMap';
import { injectable } from 'inversify';
import { Listeners } from '../../../communication/listeners';
import { Synchronicity, BPRecipeInSourceWasResolved } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';

export class BPRecipeStatusChanged {
    public constructor(public readonly status: IBPRecipeStatus, public readonly changeSynchronicity: Synchronicity) { }

    public toString(): string {
        return `${this.changeSynchronicity}: ${this.status}`;
    }
}

/**
 * Calculates the status (Bound vs Unbound) for a BPRecipe. This class needs to be aware that a Client BP Recipe might generate multiple Debuggee BP Recipes
 */
@injectable()
export class BPRecipeStatusCalculator {
    public readonly bpRecipeStatusChangedListeners = new Listeners<BPRecipeStatusChanged, void>();

    private readonly _recipeToStatusAtLocation = new ValidatedMap<BPRecipeInSource, IValidatedMap<LocationInLoadedSource, BPRecipeIsBoundInRuntimeLocation>>();
    private readonly _recipeToUnboundStatus = ValidatedMultiMap.empty<BPRecipeInSource, BPRecipeIsUnbound>();

    public statusOfBPRecipe(bpRecipe: BPRecipeInSource): IBPRecipeStatus {
        const boundSubstatuses = Array.from(this._recipeToStatusAtLocation.get(bpRecipe).values());
        const unboundSubstatuses = Array.from(this._recipeToUnboundStatus.get(bpRecipe));

        return createBPRecipieStatus(bpRecipe, boundSubstatuses, unboundSubstatuses);
    }

    public clientBPRecipeIsBeingAdded(bpRecipe: BPRecipeInSource): void {
        this._recipeToStatusAtLocation.set(bpRecipe, new ValidatedMap<LocationInLoadedSource, BPRecipeIsBoundInRuntimeLocation>());
        this._recipeToUnboundStatus.addKeyIfNotExistant(bpRecipe);
    }

    public clientBPRecipeWasRemoved(bpRecipe: BPRecipeInSource): void {
        this._recipeToStatusAtLocation.delete(bpRecipe);
        this._recipeToUnboundStatus.delete(bpRecipe);
    }

    public bpRecipeIsResolved(bpRecipeWasResolved: BPRecipeInSourceWasResolved): void {
        const bpRecipe = bpRecipeWasResolved.breakpoint.recipe;
        const locationInRuntimeSource = bpRecipeWasResolved.breakpoint.actualLocation;
        const runtimeSourceToBPRStatus = this._recipeToStatusAtLocation.get(bpRecipe);
        runtimeSourceToBPRStatus.set(locationInRuntimeSource, new BPRecipeIsBoundInRuntimeLocation(bpRecipe, locationInRuntimeSource,
            [bpRecipeWasResolved.breakpoint]));
        this.bpRecipeStatusChangedListeners.call(new BPRecipeStatusChanged(this.statusOfBPRecipe(bpRecipe), bpRecipeWasResolved.resolutionSynchronicity));
    }

    public bpRecipeFailedToBind(bpRecipeIsUnbound: BPRecipeIsUnbound): void {
        this._recipeToUnboundStatus.add(bpRecipeIsUnbound.recipe, bpRecipeIsUnbound);
        this.bpRecipeStatusChangedListeners.call(new BPRecipeStatusChanged(this.statusOfBPRecipe(bpRecipeIsUnbound.recipe), Synchronicity.Sync));
    }

    public toString(): string {
        return `${printMap(`BPRecipe status calculator:`, this._recipeToStatusAtLocation)} ${printMap(`Unbound bps:`, this._recipeToUnboundStatus)}`;
    }
}
