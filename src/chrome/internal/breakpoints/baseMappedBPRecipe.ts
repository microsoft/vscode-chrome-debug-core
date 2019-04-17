import { Location, ScriptOrSourceOrURLOrURLRegexp, LocationInScript, LocationInUrlRegexp, LocationInUrl, LocationInLoadedSource } from '../locations/location';
import { IBPActionWhenHit, AlwaysPause } from './bpActionWhenHit';
import { BaseBPRecipe, IBPRecipe, BPInScriptSupportedHitActions } from './bpRecipe';
import { BPRecipeInSource } from './bpRecipeInSource';
import { ILoadedSource } from '../sources/loadedSource';
import { IScript } from '../scripts/script';
import { createURLRegexp, URLRegexp } from '../locations/subtypes';
import { IURL } from '../sources/resourceIdentifier';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import * as utils from '../../../utils';
import { IMappedTokensInScript } from '../locations/mappedTokensInScript';

export interface IMappedBPRecipe<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit>
    extends IBPRecipe<TResource, TBPActionWhenHit> {
    unmappedBPRecipe: BPRecipeInSource<IBPActionWhenHit>;
}

/**
 * This is the base class for classes representing BP Recipes that were mapped in some way (The unmapped BP recipe is the exact
 * recipe specified by the client using the ISource interface)
 */
abstract class BaseMappedBPRecipe<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit>
    extends BaseBPRecipe<TResource, TBPActionWhenHit> {

    constructor(public readonly unmappedBPRecipe: BPRecipeInSource<TBPActionWhenHit>, public readonly location: Location<TResource>) {
        super();
    }

    public get bpActionWhenHit(): TBPActionWhenHit {
        return this.unmappedBPRecipe.bpActionWhenHit;
    }

    public isEquivalentTo(right: IBPRecipe<TResource, TBPActionWhenHit>): boolean {
        return this.location.isEquivalentTo(right.location)
            && (right instanceof BaseMappedBPRecipe)
            && right.unmappedBPRecipe.isEquivalentTo(this.unmappedBPRecipe);
    }

    public toString(): string {
        return `BP @ ${this.location} do: ${this.bpActionWhenHit}`;
    }

}

export class BPRecipeInLoadedSource<TBPActionWhenHit extends IBPActionWhenHit> extends BaseMappedBPRecipe<ILoadedSource, TBPActionWhenHit>  {
    public tokensWhenMappedToScript(): IMappedTokensInScript[] {
        return this.location.tokensWhenMappedToScript();
    }

    public withAlwaysPause(): BPRecipeInLoadedSource<AlwaysPause> {
        return new BPRecipeInLoadedSource(this.unmappedBPRecipe.withAlwaysPause(), this.location);
    }
}

export interface IBPRecipeForRuntimeSource<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit>
    extends IMappedBPRecipe<TResource, TBPActionWhenHit> {
    readonly runtimeSourceLocation: LocationInLoadedSource; // We use this to compare whether a breakpoint recipe was set already, to easily determine if we had already set this same url before or not
}

export class BPRecipeInScript extends BaseMappedBPRecipe<IScript, BPInScriptSupportedHitActions>
    implements IBPRecipeForRuntimeSource<IScript, BPInScriptSupportedHitActions> {
    private static nextBPGuid = 89000000;

    public get runtimeSourceLocation(): LocationInLoadedSource {
        return this.location.mappedToRuntimeSource();
    }

    /**
     * We use CDTP.getPossibleBreakpoints to find the best position to set a breakpoint. We use withLocationReplaced to get a new
     * BPRecipeInScript instance that is located on the place suggested by CDTP.getPossibleBreakpoints
     */
    public withLocationReplaced(newLocation: LocationInScript): BPRecipeInScript {
        return new BPRecipeInScript(this.unmappedBPRecipe, newLocation);
    }

    /**
     * We use mappedToUrlRegexp to transform this BP Recipe into a similar recipe specified in an URL Regexp instead.
     */
    public mappedToUrlRegexp(): BPRecipeInUrlRegexp {
        const urlRegexp = createURLRegexp(utils.pathToRegex(this.location.script.url, `${BPRecipeInScript.nextBPGuid++}`));
        return new BPRecipeInUrlRegexp(this.unmappedBPRecipe, new LocationInUrlRegexp(urlRegexp, this.location.position), this.runtimeSourceLocation);
    }

    public mappedToUrl(): BPRecipeInUrl {
        const url = this.location.script.runtimeSource.identifier;
        return new BPRecipeInUrl(this.unmappedBPRecipe, new LocationInUrl(url, this.location.position), this.runtimeSourceLocation);
    }

    public mappedToRuntimeSource(): BPRecipeInLoadedSource<BPInScriptSupportedHitActions> {
        return new BPRecipeInLoadedSource(this.unmappedBPRecipe, this.location.mappedToRuntimeSource());
    }
}

export class BPRecipeInUrl extends BaseMappedBPRecipe<IURL<CDTPScriptUrl>, BPInScriptSupportedHitActions>
    implements IBPRecipeForRuntimeSource<IURL<CDTPScriptUrl>, BPInScriptSupportedHitActions> {
    public constructor(
        unmappedBPRecipe: BPRecipeInSource,
        location: LocationInUrl,
        public readonly runtimeSourceLocation: LocationInLoadedSource) {
        super(unmappedBPRecipe, location);
    }

}
export class BPRecipeInUrlRegexp extends BaseMappedBPRecipe<URLRegexp, BPInScriptSupportedHitActions>
    implements IBPRecipeForRuntimeSource<URLRegexp, BPInScriptSupportedHitActions> {
    public constructor(
        unmappedBPRecipe: BPRecipeInSource,
        location: LocationInUrlRegexp,
        public readonly runtimeSourceLocation: LocationInLoadedSource) {
        super(unmappedBPRecipe, location);
    }
}
