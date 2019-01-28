import { Location, ScriptOrSourceOrURLOrURLRegexp, LocationInScript, LocationInUrlRegexp, LocationInUrl } from '../locations/location';
import { IBPActionWhenHit } from './bpActionWhenHit';
import { BaseBPRecipie, IBPRecipie, BPInScriptSupportedHitActions } from './bpRecipie';
import { BPRecipieInSource } from './bpRecipieInSource';
import { ILoadedSource } from '../sources/loadedSource';
import { IScript } from '../scripts/script';
import { createURLRegexp, URLRegexp } from '../locations/subtypes';
import { utils } from '../../..';
import { IURL } from '../sources/resourceIdentifier';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';

export interface IMappedBPRecipie<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit>
    extends IBPRecipie<TResource, TBPActionWhenHit> {
    unmappedBPRecipie: BPRecipieInSource<IBPActionWhenHit>;
}

/**
 * This is the base class for classes representing BP Recipies that were mapped in some way (The unmapped BP recipie is the exact
 * recipie specified by the client using the ISource interface)
 */
abstract class BaseMappedBPRecipie<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit>
    extends BaseBPRecipie<TResource, TBPActionWhenHit> {

    constructor(public readonly unmappedBPRecipie: BPRecipieInSource<TBPActionWhenHit>, public readonly location: Location<TResource>) {
        super();
    }

    public get bpActionWhenHit(): TBPActionWhenHit {
        return this.unmappedBPRecipie.bpActionWhenHit;
    }

    public isEquivalentTo(right: IBPRecipie<TResource, TBPActionWhenHit>): boolean {
        return this.location.isEquivalentTo(right.location)
            && (right instanceof BaseMappedBPRecipie)
            && right.unmappedBPRecipie.isEquivalentTo(this.unmappedBPRecipie);
    }

    public toString(): string {
        return `BP @ ${this.location} do: ${this.bpActionWhenHit}`;
    }
}

export class BPRecipieInLoadedSource<TBPActionWhenHit extends IBPActionWhenHit> extends BaseMappedBPRecipie<ILoadedSource, TBPActionWhenHit>  {
    public mappedToScript(): BPRecipieInScript {
        return new BPRecipieInScript(this.unmappedBPRecipie, this.location.mappedToScript());
    }
}

export class BPRecipieInScript extends BaseMappedBPRecipie<IScript, BPInScriptSupportedHitActions> {
    private static nextBPGuid = 89000000;

    /**
     * We use CDTP.getPossibleBreakpoints to find the best position to set a breakpoint. We use withLocationReplaced to get a new
     * BPRecipieInScript instance that is located on the place suggested by CDTP.getPossibleBreakpoints
     */
    public withLocationReplaced(newLocation: LocationInScript): BPRecipieInScript {
        return new BPRecipieInScript(this.unmappedBPRecipie, newLocation);
    }

    /**
     * We use mappedToUrlRegexp to transform this BP Recipie into a similar recipie specified in an URL Regexp instead.
     */
    public mappedToUrlRegexp(): BPRecipieInUrlRegexp {
        const urlRegexp = createURLRegexp(utils.pathToRegex(this.location.script.url, `${BPRecipieInScript.nextBPGuid++}`));
        return new BPRecipieInUrlRegexp(this.unmappedBPRecipie, new LocationInUrlRegexp(urlRegexp, this.location.position));
    }

    public mappedToUrl(): BPRecipieInUrl {
        const url = this.location.script.runtimeSource.identifier;
        return new BPRecipieInUrl(this.unmappedBPRecipie, new LocationInUrl(url, this.location.position));
    }
}

export class BPRecipieInUrl extends BaseMappedBPRecipie<IURL<CDTPScriptUrl>, BPInScriptSupportedHitActions> { }
export class BPRecipieInUrlRegexp extends BaseMappedBPRecipie<URLRegexp, BPInScriptSupportedHitActions> { }
