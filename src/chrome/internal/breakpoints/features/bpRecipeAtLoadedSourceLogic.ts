/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as _ from 'lodash';
import * as chromeUtils from '../../../chromeUtils';
import { IDebuggeeBreakpointsSetter } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { IBreakpointFeaturesSupport } from '../../../cdtpDebuggee/features/cdtpBreakpointFeaturesSupport';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { ReasonType } from '../../../stoppedEvent';
import { CDTPBreakpoint, CDTPBPRecipe } from '../../../cdtpDebuggee/cdtpPrimitives';
import { DebuggeeBPRsSetForClientBPRFinder } from '../registries/debuggeeBPRsSetForClientBPRFinder';
import { BPRecipeInLoadedSource } from '../BaseMappedBPRecipe';
import { ConditionalPause, AlwaysPause } from '../bpActionWhenHit';
import { PausedEvent } from '../../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { BPRecipe } from '../bpRecipe';
import { ISource } from '../../sources/source';
import { LocationInScript, Position } from '../../locations/location';
import { createColumnNumber, createLineNumber } from '../../locations/subtypes';
import { RangeInResource } from '../../locations/rangeInScript';
import { logger } from 'vscode-debugadapter/lib/logger';
import { asyncMap } from '../../../collections/async';
import { wrapWithMethodLogger } from '../../../logging/methodsCalledLogger';
import { BaseNotifyClientOfPause, IActionToTakeWhenPaused, NoActionIsNeededForThisPause } from '../../features/actionToTakeWhenPaused';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';
import { BPRecipeIsUnbound } from '../bpRecipeStatusForRuntimeLocation';
import { Listeners } from '../../../communication/listeners';
import { inject, injectable, LazyServiceIdentifer } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PrivateTypes } from '../diTypes';

export class HitBreakpoint extends BaseNotifyClientOfPause {
    protected reason: ReasonType = 'breakpoint';

    constructor(protected readonly _eventsToClientReporter: IEventsToClientReporter) {
        super();
    }
}

export interface IBPRecipeAtLoadedSourceSetter {
    addBreakpointAtLoadedSource(bpRecipe: BPRecipeInLoadedSource<ConditionalPause | AlwaysPause>): Promise<CDTPBreakpoint[]>;
    removeDebuggeeBPRs(clientBPRecipe: BPRecipe<ISource>): Promise<void>;
}

/**
 * Handles setting breakpoints on sources that are associated with scripts already loaded
 */
@injectable()
export class BPRecipeAtLoadedSourceSetter implements IBPRecipeAtLoadedSourceSetter {
    private readonly doesTargetSupportColumnBreakpointsCached: Promise<boolean>;
    public readonly debuggeeBPRecipeAddedListeners = new Listeners<CDTPBPRecipe, void>();
    public readonly debuggeeBPRecipeRemovedListeners = new Listeners<CDTPBPRecipe, void>();
    public readonly bpRecipeIsUnboundListeners = new Listeners<BPRecipeIsUnbound, void>();

    public readonly withLogging = wrapWithMethodLogger(this);

    constructor(
        @inject(TYPES.IBreakpointFeaturesSupport) private readonly _breakpointFeaturesSupport: IBreakpointFeaturesSupport,
        @inject(new LazyServiceIdentifer(() => PrivateTypes.DebuggeeBPRsSetForClientBPRFinder)) private readonly _bpRecipesRegistry: DebuggeeBPRsSetForClientBPRFinder,
        @inject(TYPES.IDebuggeeBreakpointsSetter) private readonly _targetBreakpoints: IDebuggeeBreakpointsSetter,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter,
        @inject(TYPES.IDebuggeePausedHandler) private readonly _debuggeePausedHandler: IDebuggeePausedHandler) {
        this.doesTargetSupportColumnBreakpointsCached = this._breakpointFeaturesSupport.supportsColumnBreakpoints;
        this._debuggeePausedHandler.registerActionProvider(paused => this.withLogging.onProvideActionForWhenPaused(paused));
    }

    public async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        if (paused.hitBreakpoints && paused.hitBreakpoints.length > 0) {
            // TODO DIEGO: Improve this to consider breakpoints where we shouldn't pause
            return new HitBreakpoint(this._eventsToClientReporter);
        } else {
            return new NoActionIsNeededForThisPause(this);
        }
    }

    public async addBreakpointAtLoadedSource(bpRecipe: BPRecipeInLoadedSource<ConditionalPause | AlwaysPause>): Promise<CDTPBreakpoint[]> {
        try {
            const bpsInScriptRecipe = bpRecipe.mappedToScript();

            const breakpoints = _.flatten(await asyncMap(bpsInScriptRecipe, async bpInScriptRecipe => {
                const bestLocation = await this.considerColumnAndSelectBestBPLocation(bpInScriptRecipe.location);
                const bpRecipeInBestLocation = bpInScriptRecipe.withLocationReplaced(bestLocation);

                const runtimeSource = bpInScriptRecipe.location.script.runtimeSource;

                let breakpoints: CDTPBreakpoint[];
                if (!runtimeSource.doesScriptHasUrl()) {
                    breakpoints = [await this._targetBreakpoints.setBreakpoint(bpRecipeInBestLocation)];
                } else {
                    /**
                     * If the script is a local file path, we *need* to transform it into an url to be able to set the breakpoint
                     *
                     * If the script has an URL and it's not a local file path, then we could actually leave it as-is.
                     * We transform it into a regexp anyway to add a GUID to it, so CDTP will let us add the same breakpoint/recipe two times (using different guids).
                     * That way we can always add the new breakpoints for a file, before removing the old ones (except if the script doesn't have an URL)
                     */
                    breakpoints = await this._targetBreakpoints.setBreakpointByUrlRegexp(bpRecipeInBestLocation.mappedToUrlRegexp());
                }

                for (const breakpoint of breakpoints) {
                    // The onBreakpointResolvedSyncOrAsync handler will notify us that a breakpoint was bound, and send the status update to the client if neccesary
                    await this.debuggeeBPRecipeAddedListeners.call(breakpoint.recipe);
                }

                return breakpoints;
            }));
            return breakpoints;
        }
        catch (exception) {
            this.bpRecipeIsUnboundListeners.call(new BPRecipeIsUnbound(bpRecipe.unmappedBPRecipe, exception)); // We publish it so the breakpoint itself will have this information in the tooltip
            throw exception; // We throw the exceptio so the call that the client made will fail
        }
    }

    public async removeDebuggeeBPRs(clientBPRecipe: BPRecipe<ISource>): Promise<void> {
        const debuggeeBPRecipes = this._bpRecipesRegistry.findDebuggeeBPRsSet(clientBPRecipe);
        await asyncMap(debuggeeBPRecipes, async bpr => {
            await this._targetBreakpoints.removeBreakpoint(bpr);
            await this.debuggeeBPRecipeRemovedListeners.call(bpr);
        });
    }

    private async considerColumnAndSelectBestBPLocation(location: LocationInScript): Promise<LocationInScript> {
        if (await this.doesTargetSupportColumnBreakpointsCached) {
            const thisLineStart = new Position(location.position.lineNumber, createColumnNumber(0));
            const nextLineStart = new Position(createLineNumber(location.position.lineNumber + 1), createColumnNumber(0));
            const thisLineRange = new RangeInResource(location.script, thisLineStart, nextLineStart);

            const possibleLocations = await this._targetBreakpoints.getPossibleBreakpoints(thisLineRange);

            if (possibleLocations.length > 0) {
                const bestLocation = chromeUtils.selectBreakpointLocation(location.position.lineNumber, location.position.columnNumber, possibleLocations);
                logger.verbose(`PossibleBreakpoints: Best location for ${location} is ${bestLocation}`);
                return bestLocation;
            }
        }

        return location;
    }

    public toString(): string {
        return 'BPRecipeAtLoadedSourceLogic';
    }
}