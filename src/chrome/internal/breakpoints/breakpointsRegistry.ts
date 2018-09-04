import { IBPRecipieStatus, BPRecipieIsBinded, BPRecipieIsUnbinded } from './bpRecipieStatus';
import { IBreakpoint } from './breakpoint';
import { ValidatedMultiMap } from '../../collections/validatedMultiMap';
import { BPRecipie, IBPRecipie } from './bpRecipie';
import { ScriptOrSourceOrIdentifierOrUrlRegexp, LocationInScript } from '../locations/location';

export class BreakpointsRegistry {
    // TODO DIEGO: Figure out how to handle if two breakpoint rules set a breakpoint in the same location so it ends up being the same breakpoint id
    private readonly _unmappedRecipieToBreakpoints = new ValidatedMultiMap<IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>,
        IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>>();

    public registerBPRecipie(bpRecipie: BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): void {
        this._unmappedRecipieToBreakpoints.addKeyIfNotExistant(bpRecipie);
    }

    public registerBreakpointAsBinded(bp: IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>): void {
        this._unmappedRecipieToBreakpoints.add(bp.recipie.unmappedBpRecipie, bp);
    }

    public getStatusOfBPRecipie(bpRecipie: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): IBPRecipieStatus {
        const breakpoints = this._unmappedRecipieToBreakpoints.get(bpRecipie);
        if (breakpoints.size > 0) {
            return new BPRecipieIsBinded(bpRecipie, Array.from(breakpoints), 'TODO DIEGO');
        } else {
            return new BPRecipieIsUnbinded(bpRecipie, 'TODO DIEGO');
        }
    }

    public tryGettingBreakpointAtLocation(locationInScript: LocationInScript): IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>[] {
        // TODO DIEGO: Figure out if we need a faster algorithm for this
        const matchinbBps = [];
        for (const bps of this._unmappedRecipieToBreakpoints.values()) {
            for (const bp of bps) {
                if (bp.actualLocation.isSameAs(locationInScript)) {
                    matchinbBps.push(bp);
                }
            }
        }

        return matchinbBps;
    }

    public toString(): string {
        return `Breakpoints recipie status Registry:\nRecipie to breakpoints: ${this._unmappedRecipieToBreakpoints}`;
    }
}
