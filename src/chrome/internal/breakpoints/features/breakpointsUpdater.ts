/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BPRecipesInSource } from '../bpRecipes';
import { asyncMap } from '../../../collections/async';
import { IBPRecipeStatus } from '../bpRecipeStatus';
import { BPRsDeltaCalculatorFromStoredBPRs } from '../registries/bprsDeltaCalculatorFromStoredBPRs';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { inject, injectable, LazyServiceIdentifer } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { ITelemetryPropertyCollector } from '../../../../telemetry';
import { PrivateTypes } from '../diTypes';
import { SingleBreakpointSetterWithHitCountSupport } from './singleBreakpointSetterWithHitCountSupport';
import { CurrentBPRecipeStatusRetriever } from '../registries/currentBPRecipeStatusRetriever';
import { HitBreakpoint } from './bpRecipeAtLoadedSourceLogic';
import { BPRecipeStatusChanged, BPRecipeStatusCalculator } from '../registries/bpRecipeStatusCalculator';
import { Synchronicity } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { logger } from 'vscode-debugadapter';
import { Listeners } from '../../../communication/listeners';
import { BPRecipeIsUnbound } from '../bpRecipeStatusForRuntimeLocation';
import { PauseScriptLoadsToSetBPs } from './pauseScriptLoadsToSetBPs';
import { ConnectedCDAConfiguration } from '../../../client/chromeDebugAdapter/cdaConfiguration';

/**
 * Update the breakpoint recipes for a particular source
 */
@injectable()
export class BreakpointsUpdater {
    public bpRecipeStatusChangedListeners = new Listeners<BPRecipeStatusChanged, void>();

    private _isBpsWhileLoadingEnable = false;

    constructor(
        @inject(new LazyServiceIdentifer(() => TYPES.ConnectedCDAConfiguration)) private readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter,
        @inject(PrivateTypes.CurrentBPRecipesForSourceRegistry) private readonly _clientCurrentBPRecipesRegistry: BPRsDeltaCalculatorFromStoredBPRs,
        @inject(PrivateTypes.SingleBreakpointSetterWithHitCountSupport) private readonly _singleBreakpointSetter: SingleBreakpointSetterWithHitCountSupport,
        @inject(PrivateTypes.CurrentBPRecipeStatusRetriever) private readonly _currentBPRecipeStatusRetriever: CurrentBPRecipeStatusRetriever,
        @inject(new LazyServiceIdentifer(() => PrivateTypes.PauseScriptLoadsToSetBPs)) private readonly _pauseScriptLoadsToSetBPs: PauseScriptLoadsToSetBPs,
        @inject(PrivateTypes.BPRecipeStatusCalculator) private readonly _bpRecipeStatusCalculator: BPRecipeStatusCalculator) {
        this._bpRecipeStatusCalculator.bpRecipeStatusChangedListeners.add(bpRecipe => this.onBPRecipeStatusChanged(bpRecipe));
        this._singleBreakpointSetter.bpRecipeStatusChangedListeners.add(bpRecipe => this.onBPRecipeStatusChanged(bpRecipe));
        this._singleBreakpointSetter.setOnPausedForBreakpointCallback(async _bpRecipes => new HitBreakpoint(this._eventsToClientReporter));
        this._singleBreakpointSetter.setBPRecipeWasResolvedCallback(bpRecipeWasResolved => {
            this._bpRecipeStatusCalculator.bpRecipeIsResolved(bpRecipeWasResolved);
            this._pauseScriptLoadsToSetBPs.bpRecipeIsResolved(bpRecipeWasResolved);
        });
    }

    protected async onBPRecipeStatusChanged(statusChanged: BPRecipeStatusChanged): Promise<void> {
        // Update the status in _currentBPRecipeStatusRetriever for future queries
        this._currentBPRecipeStatusRetriever.bpRecipeStatusUpdated(statusChanged.status);

        /**
         * If this is an async update, we need to notify the client of this change.
         * If this is a sync update, this is happening during a call to setBreakpoints, so the response of setBreakpoints will notify of this change.
         * If this is sync, we should also *avoid* sending this event to the client, because the breakpoint id doesn't exist yet, so the event will be invalid
         */
        if (statusChanged.changeSynchronicity === Synchronicity.Async) {
            this.bpRecipeStatusChangedListeners.call(statusChanged);
        } else {
            logger.log(`BPRecipe status changed event not sent to the client because it was sync: ${statusChanged}`);
        }
    }

    public async updateBreakpointsForFile(requestedBPs: BPRecipesInSource, _?: ITelemetryPropertyCollector): Promise<IBPRecipeStatus[]> {
        const bpsDelta = this._clientCurrentBPRecipesRegistry.updateBPRecipesAndCalculateDelta(requestedBPs);

        // We only need to remove before adding if the script is loaded, and it doesn't have an URL. In any other case we can add first
        const shouldRemoveBeforeAdding = await bpsDelta.resource.tryResolving(resolvedSource => !resolvedSource.doesScriptHasUrl(), () => false);

        if (shouldRemoveBeforeAdding) {
            // TODO: We need to pause-update-resume the debugger here to avoid a race condition
            await this.removeDeletedBreakpointsFromFile(bpsDelta.existingToRemove);
            await this.addNewBreakpointsForFile(bpsDelta.requestedToAdd);
        } else {
            await this.addNewBreakpointsForFile(bpsDelta.requestedToAdd);
            await this.removeDeletedBreakpointsFromFile(bpsDelta.existingToRemove);
        }

        return bpsDelta.matchesForRequested.map(bpRecipe => this._currentBPRecipeStatusRetriever.statusOfBPRecipe(bpRecipe));
    }

    public async install(): Promise<this> {
        await this._pauseScriptLoadsToSetBPs.install();
        await this.configure();
        return this;
    }

    public async configure(): Promise<this> {
        this._isBpsWhileLoadingEnable = this._configuration.args.breakOnLoadStrategy !== 'off';
        if (this._isBpsWhileLoadingEnable) {
            await this._pauseScriptLoadsToSetBPs.enableIfNeccesary();
        }
        return this;
    }

    private async removeDeletedBreakpointsFromFile(bpRecipesToRemove: BPRecipeInSource[]) {
        await asyncMap(bpRecipesToRemove, async existingBPToRemove => {
            await this._singleBreakpointSetter.removeBPRecipe(existingBPToRemove);
            this._currentBPRecipeStatusRetriever.clientBPRecipeWasRemoved(existingBPToRemove);
            this._bpRecipeStatusCalculator.clientBPRecipeWasRemoved(existingBPToRemove);
        });
    }

    private async addNewBreakpointsForFile(requestedBPsToAdd: BPRecipeInSource[]) {
        // DIEGO TODO: Do we need to do one breakpoint at a time to avoid issues on CDTP, or can we do them in parallel now that we use a different algorithm?
        await asyncMap(requestedBPsToAdd, async requestedBP => {
            this._currentBPRecipeStatusRetriever.clientBPRecipeIsBeingAdded(requestedBP);
            this._bpRecipeStatusCalculator.clientBPRecipeIsBeingAdded(requestedBP);
            try {
                await this._singleBreakpointSetter.addBPRecipe(requestedBP);
            } catch (exception) {
                this._bpRecipeStatusCalculator.bpRecipeFailedToBind(new BPRecipeIsUnbound(requestedBP, exception)); // We publish it so the breakpoint itself will have this information in the tooltip
            }
        });
    }
}
