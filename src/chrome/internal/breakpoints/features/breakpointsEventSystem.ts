import { CDTPBPRecipe } from '../../../cdtpDebuggee/cdtpPrimitives';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { BPRecipeIsUnbound } from '../bpRecipeStatusForRuntimeLocation';
import { injectable } from 'inversify';
import { BPRecipeAtLoadedSourceSetter } from './bpRecipeAtLoadedSourceLogic';
import { SingleBreakpointSetter } from './singleBreakpointSetter';
import { BPRecipeWasResolved } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { BPRecipeStatusChanged } from '../registries/bpRecipeStatusCalculator';

export interface IBreakpointsEventsListener {
    listenForOnClientBPRecipeAdded(listener: (bpRecipie: BPRecipeInSource) => void): void;
    listenForOnClientBPRecipeRemoved(listener: (bpRecipie: BPRecipeInSource) => void): void;
    listenForOnDebuggeeBPRecipeAdded(listener: (bpRecipie: CDTPBPRecipe) => void): void;
    listenForOnDebuggeeBPRecipeRemoved(listener: (bpRecipie: CDTPBPRecipe) => void): void;
    listenForOnBPRecipeIsResolved(listener: (bpRecipeWasResolved: BPRecipeWasResolved) => void): void;
    listenForOnBPRecipeFailedToBind(listener: (bpRecipieIsUnbound: BPRecipeIsUnbound) => void): void;
}

/**
 * Make a nice interface for the event system for the breakpoints logic, so that code doesn't need to deal directly with the event system
 */
@injectable()
export class BreakpointsEventSystem implements IBreakpointsEventsListener {
    // TODO: Try to find a way to put these properties on the constructor (At the moment we get a circular reference error if we do that)
    private _singleBreakpointSetter: SingleBreakpointSetter | undefined = undefined;
    private _bpRecipeAtLoadedSourceSetter: BPRecipeAtLoadedSourceSetter | undefined = undefined;

    // TODO: Try to find a way to remove this and use the DI framework instead
    private _scheduledActions: (() => void)[] | null = [];

    public listenForOnClientBPRecipeAdded(listener: (bpRecipie: BPRecipeInSource) => void): void {
        this.schedule(() => {
            this._singleBreakpointSetter!.clientBPRecipeAddedListeners.add(listener);
        });
    }

    public listenForOnClientBPRecipeRemoved(listener: (bpRecipie: BPRecipeInSource) => void): void {
        this.schedule(() => {
            this._singleBreakpointSetter!.clientBPRecipeRemovedListeners.add(listener);
        });
    }

    public listenForOnDebuggeeBPRecipeAdded(listener: (bpRecipie: CDTPBPRecipe) => void): void {
        this.schedule(() => {
            this._bpRecipeAtLoadedSourceSetter!.debuggeeBPRecipeAddedListeners.add(listener);
        });
    }

    public listenForOnDebuggeeBPRecipeRemoved(listener: (bpRecipie: CDTPBPRecipe) => void): void {
        this.schedule(() => {
            this._bpRecipeAtLoadedSourceSetter!.debuggeeBPRecipeRemovedListeners.add(listener);
        });
    }

    public listenForOnBPRecipeIsResolved(listener: (bpRecipeWasResolved: BPRecipeWasResolved) => void): void {
        this.schedule(() => {
            this._singleBreakpointSetter!.bpRecipeIsResolvedListeners.add(listener);
        });
    }

    public listenForOnBPRecipeFailedToBind(listener: (bpRecipieIsUnbound: BPRecipeIsUnbound) => void): void {
        this.schedule(() => {
            this._bpRecipeAtLoadedSourceSetter!.bpRecipeFailedToBindListeners.add(listener);
        });
    }

    public listenForOnBPRecipeStatusChanged(listener: (bpRecipieStatus: BPRecipeStatusChanged) => void): void {
        this.schedule(() => {
            this._singleBreakpointSetter!.bpRecipeStatusChangedListeners.add(listener);
        });
    }

    public setDependencies(
        breakpointsUpdater: SingleBreakpointSetter,
        bpRecipeAtLoadedSourceLogic: BPRecipeAtLoadedSourceSetter): void {
        this._singleBreakpointSetter = breakpointsUpdater;
        this._bpRecipeAtLoadedSourceSetter = bpRecipeAtLoadedSourceLogic;

        (this._scheduledActions || []).forEach(action => action());
        this._scheduledActions = null;
    }

    private schedule(action: () => void): void {
        if (this._scheduledActions !== null) {
            this._scheduledActions.push(action);
        } else {
            action();
        }
    }
}
