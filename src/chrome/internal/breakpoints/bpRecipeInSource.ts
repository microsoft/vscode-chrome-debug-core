import { ISource } from '../sources/source';
import { Location } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { IBPActionWhenHit, PauseOnHitCount, AlwaysPause } from './bpActionWhenHit';
import { BPRecipeInLoadedSource } from './baseMappedBPRecipe';
import { BaseBPRecipe, IBPRecipe } from './bpRecipe';

export class BPRecipeInSource<TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit> extends BaseBPRecipe<ISource, TBPActionWhenHit> {
    constructor(public readonly location: Location<ISource>, public readonly bpActionWhenHit: TBPActionWhenHit) {
        super();
    }

    public isEquivalentTo(right: IBPRecipe<ISource>): boolean {
        return this.location.isEquivalentTo(right.location) &&
            this.bpActionWhenHit.isEquivalentTo(right.bpActionWhenHit);
    }

    /**
     * Hit breakpoints are implemented by setting an always break breakpoint, and then auto-resuming until the hit condition is true.
     * We use this method to create the always break breakpoint for a hit count breakpoint
     */
    public withAlwaysPause(): BPRecipeInSource<AlwaysPause> {
        return new BPRecipeInSource(this.location, new AlwaysPause());
    }

    public tryResolving<R>(succesfulAction: (breakpointInLoadedSource: BPRecipeInLoadedSource<TBPActionWhenHit>) => R,
        failedAction: (breakpointInUnboundSource: BPRecipeInSource) => R): R {

        return this.location.tryResolving(
            locationInLoadedSource => succesfulAction(new BPRecipeInLoadedSource<TBPActionWhenHit>(this, locationInLoadedSource)),
            () => failedAction(this));
    }

    public resolvedToLoadedSource(): BPRecipeInLoadedSource<TBPActionWhenHit> {
        return this.tryResolving(
            breakpointInLoadedSource => breakpointInLoadedSource,
            () => { throw new Error(`Failed to convert ${this} into a breakpoint in a loaded source`); });
    }

    public resolvedWithLoadedSource(source: ILoadedSource<string>): BPRecipeInLoadedSource<TBPActionWhenHit> {
        return new BPRecipeInLoadedSource(this, this.location.resolvedWith(source));
    }

    public isHitCountBreakpoint(): this is BPRecipeInSource<PauseOnHitCount> {
        return this.bpActionWhenHit instanceof PauseOnHitCount;
    }
}
