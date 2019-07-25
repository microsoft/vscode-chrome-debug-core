/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import * as _ from 'lodash';
import { IDebuggeeBreakpointsSetter, IEventsConsumer } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { ReasonType } from '../../../stoppedEvent';
import { CDTPBreakpoint, CDTPBPRecipe } from '../../../cdtpDebuggee/cdtpPrimitives';
import { DebuggeeBPRsSetForClientBPRFinder } from '../registries/debuggeeBPRsSetForClientBPRFinder';
import { BPRecipeInLoadedSource } from '../baseMappedBPRecipe';
import { ConditionalPause, AlwaysPause } from '../bpActionWhenHit';
import { PausedEvent } from '../../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { BPRecipe } from '../bpRecipe';
import { ISource } from '../../sources/source';
import { asyncMap } from '../../../collections/async';
import { wrapWithMethodLogger } from '../../../logging/methodsCalledLogger';
import { BaseNotifyClientOfPause, IActionToTakeWhenPaused, NoActionIsNeededForThisPause } from '../../features/actionToTakeWhenPaused';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';
import { BPRecipeIsUnbound } from '../bpRecipeStatusForRuntimeLocation';
import { Listeners } from '../../../communication/listeners';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PrivateTypes } from '../diTypes';
import { printClassDescription } from '../../../utils/printing';
import { SourceToScriptMapper } from '../../services/sourceToScriptMapper';
import { OnPausedForBreakpointCallback, defaultOnPausedForBreakpointCallback } from './onPausedForBreakpointCallback';
import { DoNotLog } from '../../../logging/decorators';

@printClassDescription
export class HitBreakpoint extends BaseNotifyClientOfPause {
    protected reason: ReasonType = 'breakpoint';

    constructor(protected readonly _eventsToClientReporter: IEventsToClientReporter) {
        super();
    }
}

export interface IBPRecipeAtLoadedSourceSetter {
    addBreakpointAtLoadedSource(bpRecipe: BPRecipeInLoadedSource<ConditionalPause | AlwaysPause>, eventsConsumer: IEventsConsumer): Promise<CDTPBreakpoint[]>;
    removeDebuggeeBPRs(clientBPRecipe: BPRecipe<ISource>): Promise<void>;
}

@printClassDescription
export class NoRecognizedBreakpoints extends NoActionIsNeededForThisPause {
    constructor(public readonly actionProvider: unknown /* Used for debugging purposes only */) {
        super(actionProvider);
    }
}

/**
 * Handles setting breakpoints on sources that are associated with scripts already loaded
 */
@injectable()
export class BPRecipeAtLoadedSourceSetter implements IBPRecipeAtLoadedSourceSetter {
    public readonly debuggeeBPRecipeAddedListeners = new Listeners<CDTPBPRecipe, void>();
    public readonly debuggeeBPRecipeRemovedListeners = new Listeners<CDTPBPRecipe, void>();
    public readonly bpRecipeFailedToBindListeners = new Listeners<BPRecipeIsUnbound, void>();
    private _onPausedForBreakpointCallback: OnPausedForBreakpointCallback = defaultOnPausedForBreakpointCallback;

    public readonly withLogging = wrapWithMethodLogger(this);

    constructor(
        @inject(PrivateTypes.DebuggeeBPRsSetForClientBPRFinder) private readonly _debuggeeBPRsSetForClientBPRFinder: DebuggeeBPRsSetForClientBPRFinder,
        @inject(TYPES.IDebuggeeBreakpointsSetter) private readonly _targetBreakpoints: IDebuggeeBreakpointsSetter,
        @inject(PrivateTypes.SourceToScriptMapper) private readonly _sourceToScriptMapper: SourceToScriptMapper,
        @inject(TYPES.IDebuggeePausedHandler) private readonly _debuggeePausedHandler: IDebuggeePausedHandler) {
        this._debuggeePausedHandler.registerActionProvider(paused => this.withLogging.onProvideActionForWhenPaused(paused));
    }

    public setOnPausedForBreakpointCallback(onPausedForBreakpointCallback: OnPausedForBreakpointCallback): void {
        if (this._onPausedForBreakpointCallback === defaultOnPausedForBreakpointCallback) {
            this._onPausedForBreakpointCallback = onPausedForBreakpointCallback;
        } else {
            throw new Error(localize('error.loadedSourceSetter.callbacAlreadyConfigured', 'setOnPausedForBreakpointCallback was already configured to a different value'));
        }
    }

    @DoNotLog()
    public async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        if (paused.hitBreakpoints.length > 0) {
            const bpRecipes = paused.hitBreakpoints.filter(bp => this._debuggeeBPRsSetForClientBPRFinder.containsBPRecipe(bp.unmappedBPRecipe));
            if (bpRecipes.length >= 1) {
                return this._onPausedForBreakpointCallback(bpRecipes.map(bpRecipe => bpRecipe.unmappedBPRecipe));
            } else {
                // We could've hit a breakpoint from another domain (e.g.: Hit count breakpoints) or from the Chrome DevTools
                return new NoRecognizedBreakpoints(this);
            }
        } else {
            return new NoActionIsNeededForThisPause(this);
        }
    }

    public async addBreakpointAtLoadedSource(bpRecipe: BPRecipeInLoadedSource<ConditionalPause | AlwaysPause>, eventsConsumer: IEventsConsumer): Promise<CDTPBreakpoint[]> {
        try {
            const manyBpInScriptRecipes = await this._sourceToScriptMapper.mapBPRecipe(bpRecipe);

            const breakpoints = _.flatten(await asyncMap(manyBpInScriptRecipes, async bpInScriptRecipe => {
                const runtimeSource = bpInScriptRecipe.location.script.runtimeSource;

                let breakpoints: CDTPBreakpoint[];
                if (!runtimeSource.doesScriptHasUrl()) {
                    breakpoints = [await this._targetBreakpoints.setBreakpoint(bpInScriptRecipe, eventsConsumer)];
                } else {
                    /**
                     * If the script is a local file path, we *need* to transform it into an url to be able to set the breakpoint
                     *
                     * If the script has an URL and it's not a local file path, then we could actually leave it as-is.
                     * We transform it into a regexp anyway to add a GUID to it, so CDTP will let us add the same breakpoint/recipe two times (using different guids).
                     * That way we can always add the new breakpoints for a file, before removing the old ones (except if the script doesn't have an URL)
                     */
                    breakpoints = await this._targetBreakpoints.setBreakpointByUrlRegexp(bpInScriptRecipe.mappedToUrlRegexp(), eventsConsumer);
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
            this.bpRecipeFailedToBindListeners.call(new BPRecipeIsUnbound(bpRecipe.unmappedBPRecipe, exception)); // We publish it so the breakpoint itself will have this information in the tooltip
            throw exception; // We throw the exceptio so the call that the client made will fail
        }
    }

    public async removeDebuggeeBPRs(clientBPRecipe: BPRecipe<ISource>): Promise<void> {
        const debuggeeBPRecipes = this._debuggeeBPRsSetForClientBPRFinder.findDebuggeeBPRsSet(clientBPRecipe);
        await asyncMap(debuggeeBPRecipes, async bpr => {
            await this._targetBreakpoints.removeBreakpoint(bpr);
            await this.debuggeeBPRecipeRemovedListeners.call(bpr);
        });
    }

    public toString(): string {
        return 'BPRecipeAtLoadedSourceLogic';
    }
}