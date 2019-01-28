import { ISource } from '../sources/source';
import { Location } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { IBPActionWhenHit, AlwaysPause } from './bpActionWhenHit';
import { BPRecipieInLoadedSource } from './baseMappedBPRecipie';
import { BaseBPRecipie, IBPRecipie } from './bpRecipie';

export class BPRecipieInSource<TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit> extends BaseBPRecipie<ISource, TBPActionWhenHit> {
    constructor(public readonly location: Location<ISource>, public readonly bpActionWhenHit: TBPActionWhenHit) {
        super();
    }

    public isEquivalentTo(right: IBPRecipie<ISource>): boolean {
        return this.location.isEquivalentTo(right.location) &&
            this.bpActionWhenHit.isEquivalentTo(right.bpActionWhenHit);
    }

    /**
     * Hit breakpoints are implemented by setting an always break breakpoint, and then auto-resuming until the hit condition is true.
     * We use this method to create the always break breakpoint for a hit count breakpoint
     */
    public withAlwaysBreakAction(): BPRecipieInSource<AlwaysPause> {
        return new BPRecipieInSource<AlwaysPause>(this.location, new AlwaysPause());
    }

    public tryResolvingSource<R>(succesfulAction: (breakpointInLoadedSource: BPRecipieInLoadedSource<TBPActionWhenHit>) => R,
        failedAction: (breakpointInUnbindedSource: BPRecipieInSource) => R): R {

        return this.location.tryResolvingSource(
            locationInLoadedSource => succesfulAction(new BPRecipieInLoadedSource<TBPActionWhenHit>(this, locationInLoadedSource)),
            () => failedAction(this));
    }

    public resolvedToLoadedSource(): BPRecipieInLoadedSource<TBPActionWhenHit> {
        return this.tryResolvingSource(
            breakpointInLoadedSource => breakpointInLoadedSource,
            () => { throw new Error(`Failed to convert ${this} into a breakpoint in a loaded source`); });
    }

    public resolvedWithLoadedSource(source: ILoadedSource<string>): BPRecipieInLoadedSource<TBPActionWhenHit> {
        return new BPRecipieInLoadedSource(this, this.location.resolvedWith(source));
    }
}
