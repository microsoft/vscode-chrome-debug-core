/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BPRecipeInSource } from '../bpRecipeInSource';
import { BPRecipesInSource } from '../bpRecipes';
import { BPRsDeltaCalculator, BPRsDeltaInRequestedSource } from '../features/bpsDeltaCalculator';
import { newResourceIdentifierMap, IResourceIdentifier } from '../../sources/resourceIdentifier';
import { injectable } from 'inversify';

/**
 * Store the current list of breakpoint recipes for a particular source
 */
@injectable()
export class CurrentBPRecipesForSourceRegistry {
    private readonly _requestedSourcePathToCurrentBPRecipes = newResourceIdentifierMap<BPRecipeInSource[]>();

    public updateBPRecipesAndCalculateDelta(requestedBPRecipes: BPRecipesInSource): BPRsDeltaInRequestedSource {
        const bpsDelta = this.calculateBPSDeltaFromExistingBPs(requestedBPRecipes);
        this.storeCurrentBPRecipes(requestedBPRecipes.source.sourceIdentifier, bpsDelta.matchesForRequested);
        return bpsDelta;
    }

    public bpRecipesForSource(sourcePath: IResourceIdentifier<string>): BPRecipeInSource[] {
        return this._requestedSourcePathToCurrentBPRecipes.getOr(sourcePath, () => []);
    }

    private calculateBPSDeltaFromExistingBPs(requestedBPRecipes: BPRecipesInSource): BPRsDeltaInRequestedSource {
        const bpRecipesInSource = this.bpRecipesForSource(requestedBPRecipes.requestedSourcePath);
        return new BPRsDeltaCalculator(requestedBPRecipes.source, requestedBPRecipes, bpRecipesInSource).calculate();
    }

    private storeCurrentBPRecipes(requestedSourceIdentifier: IResourceIdentifier, bpRecipes: BPRecipeInSource[]): void {
        this._requestedSourcePathToCurrentBPRecipes.setAndReplaceIfExist(requestedSourceIdentifier, Array.from(bpRecipes));
    }

    public toString(): string {
        return `Current BP recipes for source registry {${this._requestedSourcePathToCurrentBPRecipes}}`;
    }
}
