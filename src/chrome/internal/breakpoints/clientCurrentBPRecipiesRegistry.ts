import { BPRecipiesInUnresolvedSource } from './bpRecipies';

import { BPRsDeltaCalculator, BPRsDeltaInRequestedSource } from './bpsDeltaCalculator';
import { BPRecipieInUnresolvedSource } from './bpRecipie';
import { newResourceIdentifierMap, IResourceIdentifier } from '../sources/resourceIdentifier';

export class ClientCurrentBPRecipiesRegistry {
    private readonly _requestedSourcePathToCurrentBPRecipies = newResourceIdentifierMap<BPRecipieInUnresolvedSource[]>();

    public updateBPRecipiesAndCalculateDelta(requestedBPRecipies: BPRecipiesInUnresolvedSource): BPRsDeltaInRequestedSource {
        const bpsDelta = this.calculateBPSDeltaFromExistingBPs(requestedBPRecipies);
        this.registerCurrentBPRecipies(requestedBPRecipies.resource.sourceIdentifier, bpsDelta.matchesForRequested);
        return bpsDelta;
    }

    private registerCurrentBPRecipies(requestedSourceIdentifier: IResourceIdentifier, bpRecipies: BPRecipieInUnresolvedSource[]): void {
        this._requestedSourcePathToCurrentBPRecipies.set(requestedSourceIdentifier, Array.from(bpRecipies));
    }

    private calculateBPSDeltaFromExistingBPs(requestedBPRecipies: BPRecipiesInUnresolvedSource): BPRsDeltaInRequestedSource {
        const bpRecipiesInSource = this._requestedSourcePathToCurrentBPRecipies.getOrAdd(requestedBPRecipies.requestedSourcePath, () => []);
        return new BPRsDeltaCalculator(requestedBPRecipies.resource, requestedBPRecipies, bpRecipiesInSource).calculate();
    }

    public toString(): string {
        return `Client BP Recipies Registry {${this._requestedSourcePathToCurrentBPRecipies}}`;
    }
}
