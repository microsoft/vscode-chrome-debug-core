import { IBPRecipeStatus, ImplementsBPRecipeStatus } from '../bpRecipeStatus';
import { ValidatedMap } from '../../../collections/validatedMap';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { injectable } from 'inversify';
import { LocationInLoadedSource } from '../../locations/location';

class JustCreatedBPRecipeStatus implements IBPRecipeStatus {
    [ImplementsBPRecipeStatus] = 'ImplementsBPRecipeStatus';

    public constructor(public readonly recipe: BPRecipeInSource) { }

    public get statusDescription(): string {
        return `The breakpoint hasn't been processed yet`;
    }

    public isVerified(): boolean {
        return false;
    }

    public ifHasActualLocation<T>(_ifHasAction: (actualLocation: LocationInLoadedSource) => T, ifDoesNotHaveAction: () => T): T {
        return ifDoesNotHaveAction();
    }

    public toString(): string {
        return this.statusDescription;
    }
}

@injectable()
export class CurrentBPRecipeStatusRetriever {
    private readonly _recipeToStatus = new ValidatedMap<BPRecipeInSource, IBPRecipeStatus>();

    public bpRecipeStatusUpdated(bpRecipeStatus: IBPRecipeStatus): void {
        this._recipeToStatus.replaceExisting(bpRecipeStatus.recipe, bpRecipeStatus);
    }

    public statusOfBPRecipe(bpRecipe: BPRecipeInSource): IBPRecipeStatus {
        return this._recipeToStatus.get(bpRecipe);
    }

    public clientBPRecipeIsBeingAdded(clientBPRecipe: BPRecipeInSource): void {
        this._recipeToStatus.set(clientBPRecipe, new JustCreatedBPRecipeStatus(clientBPRecipe));
    }

    public clientBPRecipeWasRemoved(clientBPRecipe: BPRecipeInSource): void {
        this._recipeToStatus.delete(clientBPRecipe);
    }
}