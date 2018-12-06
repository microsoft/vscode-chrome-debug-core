import { IBPRecipie } from './bpRecipie';
import { ITelemetryPropertyCollector } from '../../..';
import { ScriptOrSourceOrIdentifierOrUrlRegexp } from '../locations/location';
import { BPRecipiesInUnresolvedSource } from './bpRecipies';
import { Breakpoint } from './breakpoint';
import { ReAddBPsWhenSourceIsLoaded, ReAddBPsWhenSourceIsLoadedDependencies } from './features/reAddBPsWhenSourceIsLoaded';
import { asyncMap } from '../../collections/async';
import { IBPRecipieStatus } from './bpRecipieStatus';
import { ClientCurrentBPRecipiesRegistry } from './clientCurrentBPRecipiesRegistry';
import { BreakpointsRegistry } from './breakpointsRegistry';
import { BPRecipieInLoadedSourceLogic } from './bpRecipieInLoadedSourceLogic';
import { RemoveProperty } from '../../../typeUtils';
import { IEventsToClientReporter } from '../../client/eventSender';
import { PauseScriptLoadsToSetBPs, PauseScriptLoadsToSetBPsDependencies } from './features/pauseScriptLoadsToSetBPs';
import { inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface IOnPausedResult {
    didPause: boolean;
}

export interface InternalDependencies extends
    ReAddBPsWhenSourceIsLoadedDependencies,
    PauseScriptLoadsToSetBPsDependencies {

    onAsyncBreakpointResolved(listener: (params: Breakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>) => void): void;
}

export type EventsConsumedByBreakpointsLogic = RemoveProperty<InternalDependencies,
    'waitUntilUnbindedBPsAreSet' |
    'notifyAllBPsAreBinded' |
    'tryGettingBreakpointAtLocation'>;

export class BreakpointsLogic {
    private readonly _clientBreakpointsRegistry = new ClientCurrentBPRecipiesRegistry();

    protected onAsyncBreakpointResolved(breakpoint: Breakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>): void {
        this._breakpointRegistry.registerBreakpointAsBinded(breakpoint);
        this.onUnbounBPRecipieIsNowBound(breakpoint.recipie);
    }

    private onUnbounBPRecipieIsNowBound(bpRecipie: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): void {
        const bpRecipieStatus = this._breakpointRegistry.getStatusOfBPRecipie(bpRecipie);
        this._eventsToClientReporter.sendBPStatusChanged({ reason: 'changed', bpRecipieStatus });
    }

    public async updateBreakpointsForFile(requestedBPs: BPRecipiesInUnresolvedSource, _?: ITelemetryPropertyCollector): Promise<IBPRecipieStatus[]> {
        const bpsDelta = this._clientBreakpointsRegistry.updateBPRecipiesAndCalculateDelta(requestedBPs);
        const requestedBPsToAdd = new BPRecipiesInUnresolvedSource(bpsDelta.resource, bpsDelta.requestedToAdd);
        bpsDelta.requestedToAdd.forEach(requestedBP => this._breakpointRegistry.registerBPRecipie(requestedBP));
        bpsDelta.existingToBeReplaced.forEach(existingToBeReplaced => this._breakpointRegistry.registerBPRecipie(existingToBeReplaced.replacement));

        await requestedBPsToAdd.tryGettingBPsInLoadedSource(
            async requestedBPsToAddInLoadedSources => {
                // Match desired breakpoints to existing breakpoints

                await asyncMap(requestedBPsToAddInLoadedSources.breakpoints, async requestedBP => {
                    // DIEGO TODO: Do we need to do one breakpoint at a time to avoid issues on Crdp, or can we do them in parallel now that we use a different algorithm?
                    await this._bprInLoadedSourceLogic.addBreakpointForLoadedSource(requestedBP);
                });
                await Promise.all(bpsDelta.existingToRemove.map(async existingBPToRemove => {
                    await this._bprInLoadedSourceLogic.removeBreakpoint(existingBPToRemove);
                }));

                await asyncMap(bpsDelta.existingToBeReplaced, async existingToBeReplaced => {
                    // TODO: There is a race condition between the remove and the add line. We cannot add first and remove second, because even though
                    // the breakpoints have a different condition, the target won't let you add two breakpoints to the same exact location.
                    // We need to investigate if we can make the new breakpoint using a pseudo-regexp to make the target think that they are on different locations
                    // and thus workaround this issue
                    await this._bprInLoadedSourceLogic.removeBreakpoint(existingToBeReplaced.existingBP);
                    await this._bprInLoadedSourceLogic.addBreakpointForLoadedSource(existingToBeReplaced.replacement.asBreakpointInLoadedSource());
                });
            },
            () => {
                const existingUnbindedBPs = bpsDelta.existingToLeaveAsIs.filter(bp => !this._breakpointRegistry.getStatusOfBPRecipie(bp).isVerified());
                const requestedBPsPendingToAdd = new BPRecipiesInUnresolvedSource(bpsDelta.resource, bpsDelta.requestedToAdd.concat(existingUnbindedBPs));
                if (this._isBpsWhileLoadingEnable) {
                    this._bpsWhileLoadingLogic.enableIfNeccesary();
                }
                this._unbindedBreakpointsLogic.replaceBPsForSourceWith(requestedBPsPendingToAdd);
            });

        return bpsDelta.matchesForRequested.map(bpRecipie => this._breakpointRegistry.getStatusOfBPRecipie(bpRecipie));
    }

    constructor(private readonly _dependencies: EventsConsumedByBreakpointsLogic,
        @inject(TYPES.BreakpointsRegistry) private readonly _breakpointRegistry: BreakpointsRegistry,
        @inject(TYPES.ReAddBPsWhenSourceIsLoaded) private readonly _unbindedBreakpointsLogic: ReAddBPsWhenSourceIsLoaded,
        @inject(TYPES.PauseScriptLoadsToSetBPs) private readonly _bpsWhileLoadingLogic: PauseScriptLoadsToSetBPs,
        @inject(TYPES.BPRecipieInLoadedSourceLogic) private readonly _bprInLoadedSourceLogic: BPRecipieInLoadedSourceLogic,
        @inject(TYPES.EventSender) private readonly _eventsToClientReporter: IEventsToClientReporter,
        private readonly _isBpsWhileLoadingEnable: boolean) {
        this._dependencies.onAsyncBreakpointResolved(breakpoint => this.onAsyncBreakpointResolved(breakpoint));
    }
}