import { BPRecipieInUnresolvedSource, BPRecipie } from './bpRecipie';
import { BPRecipiesInUnresolvedSource } from './bpRecipies';
import { ISourceResolver } from '../sources/sourceResolver';
import { ILoadedSource } from '../sources/loadedSource';
import { IBPActionWhenHit } from './bpActionWhenHit';
import { SetUsingProjection } from '../../collections/setUsingProjection';

export class ReplacementForExistingBPR {
    constructor(
        public readonly existingBP: BPRecipieInUnresolvedSource,
        public readonly replacement: BPRecipieInUnresolvedSource) { }
}

function canonicalizeBPLocation(breakpoint: BPRecipieInUnresolvedSource): string {
    return JSON.stringify({
        lineNumber: breakpoint.location.lineNumber,
        columnNumber: breakpoint.location.columnNumber
    });
}

export class BPRsDeltaCalculator {
    private readonly _currentBPRecipies: SetUsingProjection<BPRecipieInUnresolvedSource, string>;

    constructor(
        public readonly requestedSourceIdentifier: ISourceResolver,
        private readonly _requestedBPRecipies: BPRecipiesInUnresolvedSource,
        currentBPRecipies: BPRecipieInUnresolvedSource[]) {
        this._currentBPRecipies = new SetUsingProjection(canonicalizeBPLocation, currentBPRecipies);
    }

    public calculate(): BPRsDeltaInRequestedSource {
        const match = {
            replacementsForExistingOnes: [] as ReplacementForExistingBPR[], // TODO DIEGO
            matchesForRequested: [] as BPRecipieInUnresolvedSource[], // Every iteration we'll add either the existing BP match, or the new BP as it's own match here
            requestedToAdd: [] as BPRecipieInUnresolvedSource[], // Every time we don't find an existing match BP, we'll add the desired BP here
            existingToLeaveAsIs: [] as BPRecipieInUnresolvedSource[], // Every time we do find an existing match BP, we'll add the existing BP here
            existingToRemove: [] as BPRecipieInUnresolvedSource[] // Calculated at the end of the algorithm by doing (existingBreakpoints - existingToLeaveAsIs)
        };

        this._requestedBPRecipies.breakpoints.forEach(requestedBP => {
            const existingMatch = this._currentBPRecipies.tryGetting(requestedBP);

            let matchingBreakpoint;
            if (existingMatch !== undefined) {
                if (requestedBP.bpActionWhenHit.isEquivalent(existingMatch.bpActionWhenHit)) {
                    match.existingToLeaveAsIs.push(existingMatch);
                    matchingBreakpoint = existingMatch;
                } else {
                    match.replacementsForExistingOnes.push(new ReplacementForExistingBPR(existingMatch, requestedBP));
                    matchingBreakpoint = requestedBP;
                }
            } else {
                match.requestedToAdd.push(requestedBP);
                matchingBreakpoint = requestedBP;
            }
            match.matchesForRequested.push(matchingBreakpoint);
        });

        const setOfExistingToLeaveAsIs = new Set(match.existingToLeaveAsIs.concat(match.replacementsForExistingOnes.map(b => b.existingBP)));

        match.existingToRemove = Array.from(this._currentBPRecipies).filter(bp => !setOfExistingToLeaveAsIs.has(bp));

        // Do some minor validations of the result just in case
        const delta = new BPRsDeltaInRequestedSource(this.requestedSourceIdentifier, match.replacementsForExistingOnes, match.matchesForRequested,
            match.requestedToAdd, match.existingToRemove, match.existingToLeaveAsIs);
        this.validateResult(delta);
        return delta;
    }

    private validateResult(match: BPRsDeltaInRequestedSource): void {
        let errorMessage = '';
        if (match.matchesForRequested.length !== this._requestedBPRecipies.breakpoints.length) {
            errorMessage += 'Expected the matches for desired breakpoints list to have the same length as the desired breakpoints list\n';
        }

        if (match.requestedToAdd.length + match.existingToLeaveAsIs.length + match.existingToBeReplaced.length !== this._requestedBPRecipies.breakpoints.length) {
            errorMessage += 'Expected the desired breakpoints to add plus the existing breakpoints to leave as-is to have the same quantity as the total desired breakpoints\n';
        }

        if (match.existingToLeaveAsIs.length + match.existingToBeReplaced.length + match.existingToRemove.length !== this._currentBPRecipies.size) {
            errorMessage += 'Expected the existing breakpoints to leave as-is plus the existing breakpoints to remove to have the same quantity as the total existing breakpoints\n';
        }

        if (errorMessage !== '') {
            const matchJson = {
                matchesForRequested: this.printLocations(match.matchesForRequested),
                requestedToAdd: this.printLocations(match.requestedToAdd),
                existingToRemove: this.printLocations(match.existingToRemove),
                existingToLeaveAsIs: this.printLocations(match.existingToLeaveAsIs),
                existingToBeReplaced: this.printLocationsOfReplacements(match.existingToBeReplaced),
            };

            const additionalDetails = `\nDesired breakpoints = ${JSON.stringify(this._requestedBPRecipies.breakpoints.map(canonicalizeBPLocation))}`
                + `\Existing breakpoints = ${JSON.stringify(Array.from(this._currentBPRecipies).map(canonicalizeBPLocation))}`
                + `\nMatch = ${JSON.stringify(matchJson)}`;
            throw new Error(errorMessage + `\nmatch: ${additionalDetails}`);
        }
    }

    private printLocationsOfReplacements(existingToBeReplaced: ReplacementForExistingBPR[]): string[] {
        return existingToBeReplaced.map(rp =>
            `At ${rp.existingBP.location.coordinates} change <${rp.existingBP.bpActionWhenHit}> to <${rp.replacement.bpActionWhenHit}>`);
    }

    private printLocations(bpRecipies: BPRecipieInUnresolvedSource<IBPActionWhenHit>[]): string[] {
        return bpRecipies.map(bpRecipie => `${bpRecipie.location.coordinates}`);
    }

    public toString(): string {
        return `BPs Delta Calculator {\n\tRequested BPs: ${this._requestedBPRecipies}\n\tExisting BPs: ${this._currentBPRecipies}\n}`;
    }
}

export abstract class BPRsDeltaCommonLogic<TResource extends ILoadedSource | ISourceResolver> {
    constructor(public readonly resource: TResource,
        public readonly existingToBeReplaced: ReplacementForExistingBPR[],
        public readonly matchesForRequested: BPRecipie<TResource>[],
        public readonly requestedToAdd: BPRecipie<TResource>[],
        public readonly existingToRemove: BPRecipie<TResource>[],
        public readonly existingToLeaveAsIs: BPRecipie<TResource>[]) { }
}

export class BPRsDeltaInRequestedSource extends BPRsDeltaCommonLogic<ISourceResolver> { }

export class BPRsDeltaInLoadedSource extends BPRsDeltaCommonLogic<ILoadedSource> { }
