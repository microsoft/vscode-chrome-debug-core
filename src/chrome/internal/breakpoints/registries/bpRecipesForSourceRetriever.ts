/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BPRecipeInSource } from '../bpRecipeInSource';
import { newResourceIdentifierMap, IResourceIdentifier } from '../../sources/resourceIdentifier';
import { injectable } from 'inversify';
import { ValidatedMultiMap } from '../../../collections/validatedMultiMap';
import { IValidatedSet } from '../../../collections/validatedSet';

/**
 * Store the current list of breakpoint recipes for a particular source
 */
@injectable()
export class BPRecipesForSourceRetriever {
    private readonly _sourcePathToBPRecipes = ValidatedMultiMap.usingCustomMap(newResourceIdentifierMap<IValidatedSet<BPRecipeInSource>>());

    public bpRecipesForSource(sourcePath: IResourceIdentifier<string>): BPRecipeInSource[] {
        return Array.from(this._sourcePathToBPRecipes.getOr(sourcePath, () => new Set()).keys());
    }

    public bpRecipeIsBeingAdded(bpRecipeBeingAdded: BPRecipeInSource): void {
        this._sourcePathToBPRecipes.add(bpRecipeBeingAdded.location.resource.sourceIdentifier, bpRecipeBeingAdded);
    }

    public bpRecipeWasRemoved(removedBPRecipe: BPRecipeInSource): void {
        this._sourcePathToBPRecipes.removeValue(removedBPRecipe.location.resource.sourceIdentifier, removedBPRecipe);
    }

    public toString(): string {
        return `BPRecipesForSourceRetriever {${this._sourcePathToBPRecipes}}`;
    }
}
