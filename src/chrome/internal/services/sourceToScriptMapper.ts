import { BPRecipeInLoadedSource, BPRecipeInScript } from '../breakpoints/baseMappedBPRecipe';
import { ConditionalPause, AlwaysPause } from '../breakpoints/bpActionWhenHit';
import { injectable, inject } from 'inversify';
import { IBreakpointFeaturesSupport } from '../../cdtpDebuggee/features/cdtpBreakpointFeaturesSupport';
import { LocationInScript } from '../locations/location';
import { RangeInScript } from '../locations/rangeInScript';
import { logger } from 'vscode-debugadapter/lib/logger';
import { IDebuggeeBreakpointsSetter } from '../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { printArray } from '../../collections/printing';
import { asyncMap } from '../../collections/async';
import { TYPES } from '../../dependencyInjection.ts/types';

@injectable()
export class SourceToScriptMapper {
    private readonly doesTargetSupportColumnBreakpointsCached: Promise<boolean>;

    constructor(
        @inject(TYPES.IBreakpointFeaturesSupport) private readonly _breakpointFeaturesSupport: IBreakpointFeaturesSupport,
        @inject(TYPES.IDebuggeeBreakpointsSetter) private readonly _targetBreakpoints: IDebuggeeBreakpointsSetter) {
        this.doesTargetSupportColumnBreakpointsCached = this._breakpointFeaturesSupport.supportsColumnBreakpoints;
    }

    public async mapBPRecipe(bpRecipe: BPRecipeInLoadedSource<ConditionalPause | AlwaysPause>): Promise<BPRecipeInScript[]> {
        const tokensInManyScripts = bpRecipe.location.tokensWhenMappedToScript();
        return asyncMap(tokensInManyScripts, async manyTokensInScript => {
            const bestLocation = this.doesTargetSupportColumnBreakpointsCached
                ? await this.findBestLocationForBP(manyTokensInScript.enclosingRange)
                : manyTokensInScript.enclosingRange.start; // If we don't support column breakpoints we set the breakpoint at the start of the range
            const bpRecipeAtBestLocation = new BPRecipeInScript(bpRecipe.unmappedBPRecipe, bestLocation);
            return bpRecipeAtBestLocation;
        });
    }

    private async findBestLocationForBP(range: RangeInScript): Promise<LocationInScript> {
        const possibleLocations = await this._targetBreakpoints.getPossibleBreakpoints(range);

        if (possibleLocations.length > 0) {
            // I'm assuming that the first location will always be the earliest/leftmost location. If that is not the case we'll need to fix this code
            const choosenLocation = possibleLocations[0];
            if (possibleLocations.length === 1) {
                logger.verbose(`Breakpoint at ${range} mapped to the only option: ${choosenLocation}`);
            } else {
                logger.verbose(`Breakpoint at ${range} can be mapped to ${printArray('many options:', possibleLocations)}. Chose the first one: ${choosenLocation}`);
            }

            return choosenLocation;
        } else {
            throw new Error(`Couldn't find a suitable position to set a breakpoin in: ${range}`);
        }
    }
}
