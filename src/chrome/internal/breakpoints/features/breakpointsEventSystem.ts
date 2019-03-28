import { CDTPBPRecipe, CDTPBreakpoint } from '../../../cdtpDebuggee/cdtpPrimitives';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { BPRecipeIsUnbound } from '../bpRecipeStatusForRuntimeLocation';
import { BreakpointsUpdater } from './breakpointsUpdater';
import { injectable, inject, LazyServiceIdentifer } from 'inversify';
import { BPRecipeAtLoadedSourceSetter } from './bpRecipeAtLoadedSourceLogic';
import { BPRecipeStatusCalculator } from '../registries/bpRecipeStatusCalculator';

export interface IBreakpointsEventsListener {
    listenForOnClientBPRecipeAdded(listener: (bpRecipie: BPRecipeInSource) => void): void;
    listenForOnClientBPRecipeRemoved(listener: (bpRecipie: BPRecipeInSource) => void): void;
    listenForOnDebuggeeBPRecipeAdded(listener: (bpRecipie: CDTPBPRecipe) => void): void;
    listenForOnDebuggeeBPRecipeRemoved(listener: (bpRecipie: CDTPBPRecipe) => void): void;
    listenForOnBreakpointIsBound(listener: (breakpoint: CDTPBreakpoint) => void): void;
    listenForOnBPRecipeIsUnbound(listener: (bpRecipieIsUnbound: BPRecipeIsUnbound) => void): void;
}

/**
 * Make a nice interface for the event system for the breakpoints logic, so that code doesn't need to deal directly with the event system
 */
@injectable()
export class BreakpointsEventSystem implements IBreakpointsEventsListener {
    // TODO: Try to find a way to put these properties on the constructor (At the moment we get a circular reference error if we do that)
    public breakpointsUpdater: BreakpointsUpdater;
    public bpRecipeStatusCalculator: BPRecipeStatusCalculator;
    public bpRecipeAtLoadedSourceLogic: BPRecipeAtLoadedSourceSetter;

    // TODO: Try to find a way to remove this and use the DI framework instead
    private _scheduledActions: (() => void)[] | null = [];

    public setDependencies(
        breakpointsUpdater: BreakpointsUpdater,
        bpRecipeStatusCalculator: BPRecipeStatusCalculator,
        bpRecipeAtLoadedSourceLogic: BPRecipeAtLoadedSourceSetter): void {
        this.breakpointsUpdater = breakpointsUpdater;
        this.bpRecipeStatusCalculator = bpRecipeStatusCalculator;
        this.bpRecipeAtLoadedSourceLogic = bpRecipeAtLoadedSourceLogic;

        this._scheduledActions.forEach(action => action());
        this._scheduledActions = null;
    }

    schedule(action: () => void): void {
        if (this._scheduledActions !== null) {
            this._scheduledActions.push(action);
        } else {
            action();
        }
    }

    public listenForOnClientBPRecipeAdded(listener: (bpRecipie: BPRecipeInSource) => void): void {
        this.schedule(() => {
            this.breakpointsUpdater.clientBPRecipeAddedListeners.add(listener);
        });
    }

    public listenForOnClientBPRecipeRemoved(listener: (bpRecipie: BPRecipeInSource) => void): void {
        this.schedule(() => {
            this.breakpointsUpdater.clientBPRecipeRemovedListeners.add(listener);
        });
    }

    public listenForOnDebuggeeBPRecipeAdded(listener: (bpRecipie: CDTPBPRecipe) => void): void {
        this.schedule(() => {
            this.bpRecipeAtLoadedSourceLogic.debuggeeBPRecipeAddedListeners.add(listener);
        });
    }

    public listenForOnDebuggeeBPRecipeRemoved(listener: (bpRecipie: CDTPBPRecipe) => void): void {
        this.schedule(() => {
            this.bpRecipeAtLoadedSourceLogic.debuggeeBPRecipeRemovedListeners.add(listener);
        });
    }

    public listenForOnBreakpointIsBound(listener: (breakpoint: CDTPBreakpoint) => void): void {
        this.schedule(() => {
            this.breakpointsUpdater.breakpointIsBoundListeners.add(listener);
        });
    }

    public listenForOnBPRecipeIsUnbound(listener: (bpRecipieIsUnbound: BPRecipeIsUnbound) => void): void {
        this.schedule(() => {
            this.bpRecipeAtLoadedSourceLogic.bpRecipeIsUnboundListeners.add(listener);
        });
    }

    public listenForOnBPRecipeStatusChanged(listener: (bpRecipie: BPRecipeInSource) => void): void {
        this.schedule(() => {
            this.bpRecipeStatusCalculator.bpRecipeStatusChangedListeners.add(listener);
        });
    }
}
