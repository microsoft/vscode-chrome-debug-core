/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { createBPRecipieStatus, IBPRecipeStatus } from '../bpRecipeStatus';
import { LocationInLoadedSource } from '../../locations/location';
import { CDTPBreakpoint } from '../../../cdtpDebuggee/cdtpPrimitives';
import { ValidatedMap, IValidatedMap } from '../../../collections/validatedMap';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { BPRecipeIsUnbound, BPRecipeIsBoundInRuntimeLocation } from '../bpRecipeStatusForRuntimeLocation';
import { IBreakpointsEventsListener } from '../features/breakpointsEventSystem';
import { printMap } from '../../../collections/printing';
import { ValidatedMultiMap } from '../../../collections/validatedMultiMap';
import { injectable, inject } from 'inversify';
import { Listeners } from '../../../communication/listeners';
import { PrivateTypes } from '../diTypes';

/**
 * Calculates the status (Bound vs Unbound) for a BPRecipe. This class needs to be aware that a Client BP Recipe might generate multiple Debuggee BP Recipes
 */
@injectable()
export class BPRecipeStatusCalculator {
    public readonly bpRecipeStatusChangedListeners = new Listeners<BPRecipeInSource, void>();

    private readonly _recipeToStatusAtLocation = new ValidatedMap<BPRecipeInSource, IValidatedMap<LocationInLoadedSource, BPRecipeIsBoundInRuntimeLocation>>();
    private readonly _recipeToUnboundStatus = new ValidatedMultiMap<BPRecipeInSource, BPRecipeIsUnbound>();

    public constructor(
        @inject(PrivateTypes.IBreakpointsEventsListener) breakpointsEventsListener: IBreakpointsEventsListener) {
        breakpointsEventsListener.listenForOnClientBPRecipeAdded(clientBPRecipe => this.onClientBPRecipeAdded(clientBPRecipe));
        breakpointsEventsListener.listenForOnClientBPRecipeRemoved(clientBPRecipe => this.onClientBPRecipeRemoved(clientBPRecipe));
        breakpointsEventsListener.listenForOnBreakpointIsBound(breakpoint => this.onBreakpointIsBound(breakpoint));
        breakpointsEventsListener.listenForOnBPRecipeIsUnbound(bpRecipeIsUnbound => this.onBPRecipeIsUnbound(bpRecipeIsUnbound));
    }

    public statusOfBPRecipe(bpRecipe: BPRecipeInSource): IBPRecipeStatus {
        const boundSubstatuses = Array.from(this._recipeToStatusAtLocation.get(bpRecipe).values());
        const unboundSubstatuses = Array.from(this._recipeToUnboundStatus.get(bpRecipe));

        return createBPRecipieStatus(bpRecipe, boundSubstatuses, unboundSubstatuses);
    }

    private onClientBPRecipeAdded(bpRecipe: BPRecipeInSource): void {
        this._recipeToStatusAtLocation.set(bpRecipe, new ValidatedMap<LocationInLoadedSource, BPRecipeIsBoundInRuntimeLocation>());
        this._recipeToUnboundStatus.addKeyIfNotExistant(bpRecipe);
    }

    private onBreakpointIsBound(breakpoint: CDTPBreakpoint): void {
        const bpRecipe = breakpoint.recipe.unmappedBPRecipe;
        const locationInRuntimeSource = breakpoint.actualLocation.mappedToRuntimeSource();
        const runtimeSourceToBPRStatus = this._recipeToStatusAtLocation.get(bpRecipe);

        runtimeSourceToBPRStatus.set(locationInRuntimeSource, new BPRecipeIsBoundInRuntimeLocation(bpRecipe, locationInRuntimeSource, [breakpoint.mappedToSource()]));
        this.bpRecipeStatusChangedListeners.call(bpRecipe);
    }

    private onBPRecipeIsUnbound(bpRecipeIsUnbound: BPRecipeIsUnbound): void {
        this._recipeToUnboundStatus.add(bpRecipeIsUnbound.recipe, bpRecipeIsUnbound);
        this.bpRecipeStatusChangedListeners.call(bpRecipeIsUnbound.recipe);
    }

    private onClientBPRecipeRemoved(bpRecipe: BPRecipeInSource): void {
        this._recipeToStatusAtLocation.delete(bpRecipe);
        this._recipeToUnboundStatus.delete(bpRecipe);
    }

    public toString(): string {
        return `${printMap(`BPRecipe status calculator:`, this._recipeToStatusAtLocation)} ${printMap(`Unbound bps:`, this._recipeToUnboundStatus)}`;
    }
}
