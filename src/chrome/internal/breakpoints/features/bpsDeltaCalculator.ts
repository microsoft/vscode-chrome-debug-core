/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BPRecipe } from '../bpRecipe';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { BPRecipesInSource } from '../bpRecipes';
import { ISource } from '../../sources/source';
import { ILoadedSource } from '../../sources/loadedSource';
import { IBPActionWhenHit } from '../bpActionWhenHit';
import { SetUsingProjection } from '../../../collections/setUsingProjection';
import assert = require('assert');
import { ValidatedSet } from '../../../collections/validatedSet';
import { printArray } from '../../../collections/printing';
import { InternalError } from '../../../utils/internalError';

function canonicalizeBPLocation(breakpoint: BPRecipeInSource): string {
    return `${breakpoint.location.position.lineNumber}:${breakpoint.location.position.columnNumber}[${breakpoint.bpActionWhenHit}]`;
}

/**
 * Calculates the difference between two sets of breakpoint recipes. We use this to figure out which breakpoint recipes we need to add and remove for a client request
 */
export class BPRsDeltaCalculator {
    private readonly _currentBPRecipes: SetUsingProjection<BPRecipeInSource, string>;

    constructor(
        public readonly requestedSourceIdentifier: ISource,
        private readonly _requestedBPRecipes: BPRecipesInSource,
        currentBPRecipes: BPRecipeInSource[]) {
        this._currentBPRecipes = new SetUsingProjection(canonicalizeBPLocation, currentBPRecipes);
    }

    public calculate(): BPRsDeltaInRequestedSource {
        const match = {
            matchesForRequested: [] as BPRecipeInSource[], // Every iteration we'll add either the existing BP match, or the new BP as it's own match here
            requestedToAdd: [] as BPRecipeInSource[], // Every time we don't find an existing match BP, we'll add the requested BP here
            existingToLeaveAsIs: [] as BPRecipeInSource[], // Every time we do find an existing match BP, we'll add the existing BP here
            existingToRemove: [] as BPRecipeInSource[] // Calculated at the end of the algorithm by doing (existingBreakpoints - existingToLeaveAsIs)
        };

        this._requestedBPRecipes.breakpoints.forEach(requestedBP => {
            const existingMatch = this._currentBPRecipes.tryGetting(requestedBP);

            let matchingBreakpoint;
            if (existingMatch !== undefined) {
                assert(requestedBP.isEquivalentTo(existingMatch), `The existing match ${existingMatch} is expected to be equivalent to the requested BP ${requestedBP}`);
                match.existingToLeaveAsIs.push(existingMatch);
                matchingBreakpoint = existingMatch;
            } else {
                match.requestedToAdd.push(requestedBP);
                matchingBreakpoint = requestedBP;
            }
            match.matchesForRequested.push(matchingBreakpoint);
        });

        const setOfExistingToLeaveAsIs = new ValidatedSet(match.existingToLeaveAsIs);

        match.existingToRemove = Array.from(this._currentBPRecipes).filter(bp => !setOfExistingToLeaveAsIs.has(bp));

        // Do some minor validations of the result just in case
        const delta = new BPRsDeltaInRequestedSource(this.requestedSourceIdentifier, match.matchesForRequested,
            match.requestedToAdd, match.existingToRemove, match.existingToLeaveAsIs);
        this.validateResult(delta);
        return delta;
    }

    private validateResult(match: BPRsDeltaInRequestedSource): void {
        let errorMessage = '';
        if (match.matchesForRequested.length !== this._requestedBPRecipes.breakpoints.length) {
            errorMessage += 'Expected the matches for requested breakpoints list to have the same length as the requested breakpoints list\n';
        }

        if (match.requestedToAdd.length + match.existingToLeaveAsIs.length !== this._requestedBPRecipes.breakpoints.length) {
            errorMessage += 'Expected the requested breakpoints to add plus the existing breakpoints to leave as-is to have the same quantity as the total requested breakpoints\n';
        }

        if (match.existingToLeaveAsIs.length + match.existingToRemove.length !== this._currentBPRecipes.size) {
            errorMessage += 'Expected the existing breakpoints to leave as-is plus the existing breakpoints to remove to have the same quantity as the total existing breakpoints\n';
        }

        if (errorMessage !== '') {
            const matchJson = {
                matchesForRequested: this.printLocations(match.matchesForRequested),
                requestedToAdd: this.printLocations(match.requestedToAdd),
                existingToRemove: this.printLocations(match.existingToRemove),
                existingToLeaveAsIs: this.printLocations(match.existingToLeaveAsIs)
            };

            const additionalDetails = `\nRequested breakpoints = ${JSON.stringify(this._requestedBPRecipes.breakpoints.map(canonicalizeBPLocation))}`
                + `\nExisting breakpoints = ${JSON.stringify(Array.from(this._currentBPRecipes).map(canonicalizeBPLocation))}\nMatch = ${JSON.stringify(matchJson)}`;
            throw new InternalError('error.deltaCalculator.invalidResult', `${errorMessage}\nmatch: ${additionalDetails}`);
        }
    }

    private printLocations(bpRecipes: BPRecipeInSource<IBPActionWhenHit>[]): string[] {
        return bpRecipes.map(bpRecipe => `${bpRecipe.location.position}`);
    }

    public toString(): string {
        return `BPs Delta Calculator {\n\tRequested BPs: ${this._requestedBPRecipes}\n\tExisting BPs: ${this._currentBPRecipes}\n}`;
    }
}

export abstract class BPRsDeltaCommonLogic<TResource extends ILoadedSource | ISource> {
    constructor(public readonly resource: TResource,
        public readonly matchesForRequested: BPRecipe<TResource>[],
        public readonly requestedToAdd: BPRecipe<TResource>[],
        public readonly existingToRemove: BPRecipe<TResource>[],
        public readonly existingToLeaveAsIs: BPRecipe<TResource>[]) { }

    public toString(): string {
        return `${printArray('New BPs', this.requestedToAdd)}\n${printArray('BPs to remove', this.existingToRemove)}\n${printArray('BPs to keep', this.existingToLeaveAsIs)}`;
    }
}

export class BPRsDeltaInRequestedSource extends BPRsDeltaCommonLogic<ISource> { }

export class BPRsDeltaInLoadedSource extends BPRsDeltaCommonLogic<ILoadedSource> { }
