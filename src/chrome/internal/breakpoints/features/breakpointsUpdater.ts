/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BPRecipesInSource, BPRecipesInLoadedSource } from '../bpRecipes';
import { ExistingBPsForJustParsedScriptSetter } from './existingBPsForJustParsedScriptSetter';
import { asyncMap } from '../../../collections/async';
import { IBPRecipeStatus } from '../bpRecipeStatus';
import { CurrentBPRecipesForSourceRegistry } from '../registries/currentBPRecipesForSourceRegistry';
import { BreakpointsSetForScriptFinder } from '../registries/breakpointsSetForScriptFinder';
import { BPRecipeAtLoadedSourceSetter } from './bpRecipeAtLoadedSourceLogic';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { PauseScriptLoadsToSetBPs } from './pauseScriptLoadsToSetBPs';
import { inject, injectable, LazyServiceIdentifer } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { IDebuggeeBreakpointsSetter } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { BPRsDeltaInRequestedSource } from './bpsDeltaCalculator';
import { ConnectedCDAConfiguration } from '../../../client/chromeDebugAdapter/cdaConfiguration';
import { IScriptParsedProvider } from '../../../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';
import { DebuggeeBPRsSetForClientBPRFinder } from '../registries/debuggeeBPRsSetForClientBPRFinder';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { IDOMInstrumentationBreakpointsSetter } from '../../../cdtpDebuggee/features/cdtpDOMInstrumentationBreakpointsSetter';
import { IDebuggeeExecutionController } from '../../../cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { IDebuggeeRuntimeVersionProvider } from '../../../cdtpDebuggee/features/cdtpDebugeeRuntimeVersionProvider';
import { IBreakpointFeaturesSupport } from '../../../cdtpDebuggee/features/cdtpBreakpointFeaturesSupport';
import { wrapWithMethodLogger } from '../../../logging/methodsCalledLogger';
import { ITelemetryPropertyCollector } from '../../../../telemetry';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';
import { BreakpointsEventSystem } from './breakpointsEventSystem';
import { BPRecipeStatusCalculator } from '../registries/bpRecipeStatusCalculator';
import { TransformedListenerRegistry } from '../../../communication/transformedListenerRegistry';
import { Listeners } from '../../../communication/listeners';
import { CDTPBreakpoint } from '../../../cdtpDebuggee/cdtpPrimitives';
import { PrivateTypes } from '../diTypes';

/**
 * Update the breakpoint recipes for a particular source
 */
@injectable()
export class BreakpointsUpdater {
    public readonly clientBPRecipeAddedListeners = new Listeners<BPRecipeInSource, void>();
    public readonly clientBPRecipeRemovedListeners = new Listeners<BPRecipeInSource, void>();
    public readonly breakpointIsBoundListeners = new Listeners<CDTPBreakpoint, void>();

    private _isBpsWhileLoadingEnable: boolean;

    constructor(
        @inject(TYPES.IDebuggeeBreakpointsSetter) private readonly _debuggeeBreakpoints: IDebuggeeBreakpointsSetter,
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.IEventsToClientReporter) protected readonly _eventsToClientReporter: IEventsToClientReporter,
        @inject(PrivateTypes.BPRecipeAtLoadedSourceSetter) private readonly _breakpointsInLoadedSource: BPRecipeAtLoadedSourceSetter,
        @inject(TYPES.IDebuggeeRuntimeVersionProvider) protected readonly _debugeeVersionProvider: IDebuggeeRuntimeVersionProvider,
        private readonly _bpRecipeStatusCalculator: BPRecipeStatusCalculator,
        private readonly _bpRecipeAtLoadedSourceLogic: BPRecipeAtLoadedSourceSetter,
        private readonly _clientCurrentBPRecipesRegistry: CurrentBPRecipesForSourceRegistry,
        @inject(PrivateTypes.IBreakpointsEventsListener) private readonly _breakpointsEventSystem: BreakpointsEventSystem,
        private readonly _bpsWhileLoadingLogic: PauseScriptLoadsToSetBPs) {

        this._breakpointsEventSystem.setDependencies(this, this._bpRecipeStatusCalculator, this._bpRecipeAtLoadedSourceLogic);

        this._bpsWhileLoadingLogic.install();
        this._bpRecipeStatusCalculator.bpRecipeStatusChangedListeners.add(bpRecipe => this.onBPRecipeStatusChanged(bpRecipe));
        this._debuggeeBreakpoints.onBreakpointResolvedSyncOrAsync(breakpoint => this.breakpointIsBoundListeners.call(breakpoint));
        this.configure();
    }

    protected onBPRecipeStatusChanged(bpRecipe: BPRecipeInSource): void {
        const bpRecipeStatus = this._bpRecipeStatusCalculator.statusOfBPRecipe(bpRecipe);
        this._eventsToClientReporter.sendBPStatusChanged({ reason: 'changed', bpRecipeStatus: bpRecipeStatus });
    }

    public async updateBreakpointsForFile(requestedBPs: BPRecipesInSource, _?: ITelemetryPropertyCollector): Promise<IBPRecipeStatus[]> {
        const bpsDelta = this._clientCurrentBPRecipesRegistry.updateBPRecipesAndCalculateDelta(requestedBPs);
        const requestedBPsToAdd = new BPRecipesInSource(bpsDelta.resource, bpsDelta.requestedToAdd);
        for (const requestedBP of bpsDelta.requestedToAdd) {
            await this.clientBPRecipeAddedListeners.call(requestedBP);
        }

        await requestedBPsToAdd.tryResolving(
            async requestedBPsToAddInLoadedSources => {
                // Match desired breakpoints to existing breakpoints
                if (requestedBPsToAddInLoadedSources.source.doesScriptHasUrl()) {
                    await this.addNewBreakpointsForFile(requestedBPsToAddInLoadedSources);
                    await this.removeDeletedBreakpointsFromFile(bpsDelta);
                } else {
                    // TODO: We need to pause-update-resume the debugger here to avoid a race condition
                    await this.removeDeletedBreakpointsFromFile(bpsDelta);
                    await this.addNewBreakpointsForFile(requestedBPsToAddInLoadedSources);
                }
            },
            () => {
                /**
                 * TODO: Implement setting breakpoints using an heuristic when we cannot resolve the source
                 * const existingUnboundBPs = bpsDelta.existingToLeaveAsIs.filter(bp => !this._bpRecipeStatusCalculator.statusOfBPRecipe(bp).isVerified());
                 * const requestedBPsPendingToAdd = new BPRecipesInSource(bpsDelta.resource, bpsDelta.requestedToAdd.concat(existingUnboundBPs));
                 */
                if (this._isBpsWhileLoadingEnable) {
                    this._bpsWhileLoadingLogic.enableIfNeccesary();
                }
            });

        return bpsDelta.matchesForRequested.map(bpRecipe => this._bpRecipeStatusCalculator.statusOfBPRecipe(bpRecipe));
    }

    private async removeDeletedBreakpointsFromFile(bpsDelta: BPRsDeltaInRequestedSource) {
        await asyncMap(bpsDelta.existingToRemove, async (existingBPToRemove) => {
            await this._breakpointsInLoadedSource.removeDebuggeeBPRs(existingBPToRemove);
            this.clientBPRecipeRemovedListeners.call(existingBPToRemove);
        });
    }

    private async addNewBreakpointsForFile(requestedBPsToAddInLoadedSources: BPRecipesInLoadedSource) {
        await asyncMap(requestedBPsToAddInLoadedSources.breakpoints, async (requestedBP) => {
            // DIEGO TODO: Do we need to do one breakpoint at a time to avoid issues on CDTP, or can we do them in parallel now that we use a different algorithm?
            await this._breakpointsInLoadedSource.addBreakpointAtLoadedSource(requestedBP);
        });
    }

    public configure(): this {
        this._isBpsWhileLoadingEnable = this._configuration.args.breakOnLoadStrategy !== 'off';
        return this;

    }
}