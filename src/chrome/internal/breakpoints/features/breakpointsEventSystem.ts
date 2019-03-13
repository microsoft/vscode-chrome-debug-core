import { CDTPBPRecipe, CDTPBreakpoint } from '../../../cdtpDebuggee/cdtpPrimitives';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { Communicator } from '../../../communication/communicator';
import { BreakpointsEvents } from './breakpointsEvents';
import { PublisherWithParamsFunction } from '../../../communication/notificationsCommunicator';
import { BPRecipeIsUnbound } from '../bpRecipeStatusForRuntimeLocation';

export interface IBreakpointsEventsListener {
    listenForOnClientBPRecipeAdded(listener: (bpRecipie: BPRecipeInSource) => void): void;
    listenForOnClientBPRecipeRemoved(listener: (bpRecipie: BPRecipeInSource) => void): void;
    listenForOnDebuggeeBPRecipeAdded(listener: (bpRecipie: CDTPBPRecipe) => void): void;
    listenForOnDebuggeeBPRecipeRemoved(listener: (bpRecipie: CDTPBPRecipe) => void): void;
    listenForOnBreakpointIsBound(listener: (breakpoint: CDTPBreakpoint) => void): void;
    listenForOnBPRecipeIsUnbound(listener: (bpRecipieIsUnbound: BPRecipeIsUnbound) => void): void;
}

export interface IBreakpointsEventsPublisher {
    publisherForClientBPRecipeAdded(): void;
    publisherForClientBPRecipeRemoved(): PublisherWithParamsFunction<BPRecipeInSource, void>;
    publisherForDebuggeeBPRecipeAdded(): PublisherWithParamsFunction<CDTPBPRecipe, void>;
    publisherForDebuggeeBPRecipeRemoved(): PublisherWithParamsFunction<CDTPBPRecipe, void>;
    publisherForBreakpointIsBound(): PublisherWithParamsFunction<CDTPBreakpoint, void>;
    publisherForBPRecipeIsUnbound(): PublisherWithParamsFunction<BPRecipeIsUnbound, void>;
}

/**
 * Make a nice interface for the event system for the breakpoints logic, so that code doesn't need to deal directly with the event system
 */
export class BreakpointsEventSystem implements IBreakpointsEventsListener, IBreakpointsEventsPublisher {
    private readonly _communicator = new Communicator();

    public listenForOnClientBPRecipeAdded(listener: (bpRecipie: BPRecipeInSource) => void): void {
        this._communicator.subscribe(BreakpointsEvents.OnClientBPRecipeAdded, listener);
    }

    public listenForOnClientBPRecipeRemoved(listener: (bpRecipie: BPRecipeInSource) => void): void {
        this._communicator.subscribe(BreakpointsEvents.OnClientBPRecipeRemoved, listener);
    }

    public listenForOnDebuggeeBPRecipeAdded(listener: (bpRecipie: CDTPBPRecipe) => void): void {
        this._communicator.subscribe(BreakpointsEvents.OnDebuggeeBPRecipeAdded, listener);
    }

    public listenForOnDebuggeeBPRecipeRemoved(listener: (bpRecipie: CDTPBPRecipe) => void): void {
        this._communicator.subscribe(BreakpointsEvents.OnDebuggeeBPRecipeRemoved, listener);
    }

    public listenForOnBreakpointIsBound(listener: (breakpoint: CDTPBreakpoint) => void): void {
        this._communicator.subscribe(BreakpointsEvents.OnBreakpointIsBound, listener);
    }

    public listenForOnBPRecipeIsUnbound(listener: (bpRecipieIsUnbound: BPRecipeIsUnbound) => void): void {
        this._communicator.subscribe(BreakpointsEvents.OnBPRecipeIsUnboundForRuntimeSource, listener);
    }

    public publisherForClientBPRecipeAdded(): PublisherWithParamsFunction<BPRecipeInSource, void> {
        return this._communicator.getPublisher(BreakpointsEvents.OnClientBPRecipeAdded);
    }

    public publisherForClientBPRecipeRemoved(): PublisherWithParamsFunction<BPRecipeInSource, void> {
        return this._communicator.getPublisher(BreakpointsEvents.OnClientBPRecipeRemoved);
    }

    public publisherForDebuggeeBPRecipeAdded(): PublisherWithParamsFunction<CDTPBPRecipe, void> {
        return this._communicator.getPublisher(BreakpointsEvents.OnDebuggeeBPRecipeAdded);
    }

    public publisherForDebuggeeBPRecipeRemoved(): PublisherWithParamsFunction<CDTPBPRecipe, void> {
        return this._communicator.getPublisher(BreakpointsEvents.OnDebuggeeBPRecipeRemoved);
    }

    public publisherForBreakpointIsBound(): PublisherWithParamsFunction<CDTPBreakpoint, void> {
        return this._communicator.getPublisher(BreakpointsEvents.OnBreakpointIsBound);
    }

    public publisherForBPRecipeIsUnbound(): PublisherWithParamsFunction<BPRecipeIsUnbound, void> {
        return this._communicator.getPublisher(BreakpointsEvents.OnBPRecipeIsUnboundForRuntimeSource);
    }
}
