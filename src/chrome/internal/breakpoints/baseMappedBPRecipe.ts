import { Location, ScriptOrSourceOrURLOrURLRegexp, LocationInScript, LocationInUrlRegexp, LocationInUrl } from '../locations/location';
import { IBPActionWhenHit } from './bpActionWhenHit';
import { BaseBPRecipe, IBPRecipe, BPInScriptSupportedHitActions } from './bpRecipe';
import { BPRecipeInSource } from './bpRecipeInSource';
import { ILoadedSource } from '../sources/loadedSource';
import { IScript } from '../scripts/script';
import { createURLRegexp, URLRegexp } from '../locations/subtypes';
import { utils } from '../../..';
import { IURL } from '../sources/resourceIdentifier';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';

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
    public mappedToScript(): BPRecipeInScript {
        return new BPRecipeInScript(this.unmappedBPRecipe, this.location.mappedToScript());
    }
}

export class BPRecipeInScript extends BaseMappedBPRecipe<IScript, BPInScriptSupportedHitActions> {
    private static nextBPGuid = 89000000;

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
        return new BPRecipeInUrlRegexp(this.unmappedBPRecipe, new LocationInUrlRegexp(urlRegexp, this.location.position));
    }

    public mappedToUrl(): BPRecipeInUrl {
        const url = this.location.script.runtimeSource.identifier;
        return new BPRecipeInUrl(this.unmappedBPRecipe, new LocationInUrl(url, this.location.position));
    }
}

export class BPRecipeInUrl extends BaseMappedBPRecipe<IURL<CDTPScriptUrl>, BPInScriptSupportedHitActions> { }
export class BPRecipeInUrlRegexp extends BaseMappedBPRecipe<URLRegexp, BPInScriptSupportedHitActions> { }
