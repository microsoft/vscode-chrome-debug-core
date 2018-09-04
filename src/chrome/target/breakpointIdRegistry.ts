import { BidirectionalMap } from '../collections/bidirectionalMap';
import { BPRecipie, IBPRecipie } from '../internal/breakpoints/bpRecipie';
import { ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { Crdp } from '../..';

export class BreakpointIdRegistry {
    // TODO DIEGO: Figure out how to handle if two breakpoint rules set a breakpoint in the same location so it ends up being the same breakpoint id
    private readonly _recipieToBreakpointId = new BidirectionalMap<IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>, Crdp.Debugger.BreakpointId>();

    public registerRecipie(cdtpBreakpointId: Crdp.Debugger.BreakpointId, bpRecipie: BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): void {
        this._recipieToBreakpointId.set(bpRecipie.unmappedBpRecipie, cdtpBreakpointId);
    }

    public unregisterRecipie(bpRecipie: BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): void {
        this._recipieToBreakpointId.deleteByLeft(bpRecipie.unmappedBpRecipie);
    }

    public getBreakpointId(bpRecipie: BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): Crdp.Debugger.BreakpointId {
        return this._recipieToBreakpointId.getByLeft(bpRecipie);
    }

    public getRecipieByBreakpointId(cdtpBreakpointId: Crdp.Debugger.BreakpointId): IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp> {
        return this._recipieToBreakpointId.getByRight(cdtpBreakpointId);
    }

    public toString(): string {
        return `Breakpoint IDs: ${this._recipieToBreakpointId}`;
    }
}
