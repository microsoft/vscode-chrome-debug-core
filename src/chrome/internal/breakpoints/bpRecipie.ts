import { ISourceResolver } from '../sources/sourceResolver';
import { Location, ScriptOrSourceOrIdentifierOrUrlRegexp, LocationInUrl, LocationInUrlRegexp, LocationInScript } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { IScript } from '../scripts/script';
import { IBPActionWhenHit, AlwaysBreak } from './bpActionWhenHit';
import { utils } from '../../..';
import { IResourceIdentifier } from '../sources/resourceIdentifier';

export interface IBPRecipie<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp, TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit> {
    readonly location: Location<TResource>;
    readonly bpActionWhenHit: TBPActionWhenHit;

    readonly unmappedBpRecipie: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>; // Original bpRecipie before any mapping was done
}

abstract class BPRecipieCommonLogic<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp, TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit> {
    public abstract get bpActionWhenHit(): TBPActionWhenHit;

    constructor(
        public readonly location: Location<TResource>) { }

    public toString(): string {
        return `BP @ ${this.location} do: ${this.bpActionWhenHit}`;
    }
}

abstract class UnamppedBPRecipieCommonLogic<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp, TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit>
    extends BPRecipieCommonLogic<TResource, TBPActionWhenHit> {

    public get unmappedBpRecipie(): IBPRecipie<TResource, TBPActionWhenHit> {
        return this;
    }

    constructor(
        location: Location<TResource>,
        public readonly bpActionWhenHit: TBPActionWhenHit) {
        super(location);
    }
}

abstract class MappedBPRecipieCommonLogic<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp, TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit> {
    public get bpActionWhenHit(): TBPActionWhenHit {
        return this.unmappedBpRecipie.bpActionWhenHit;
    }

    constructor(public readonly unmappedBpRecipie: IBPRecipie<ISourceResolver, TBPActionWhenHit>,
        public readonly location: Location<TResource>) { }

    public toString(): string {
        return `BP @ ${this.location} do: ${this.bpActionWhenHit}`;
    }
}

export class BPRecipieInLoadedSource<TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit>
    extends MappedBPRecipieCommonLogic<ILoadedSource, TBPActionWhenHit> implements IBPRecipie<ILoadedSource, TBPActionWhenHit> {

    public asBPInScriptRecipie(): BPRecipieInScript<TBPActionWhenHit> {
        return new BPRecipieInScript<TBPActionWhenHit>(this.unmappedBpRecipie, this.location.asLocationInScript());
    }
}

export class BPRecipieInUnresolvedSource<TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit> extends UnamppedBPRecipieCommonLogic<ISourceResolver, TBPActionWhenHit> implements IBPRecipie<ISourceResolver, TBPActionWhenHit> {
    public withAlwaysBreakAction(): BPRecipieInUnresolvedSource<AlwaysBreak> {
        return new BPRecipieInUnresolvedSource<AlwaysBreak>(this.location, new AlwaysBreak());
    }

    public tryGettingBreakpointInLoadedSource<R>(
        whenSuccesfulDo: (breakpointInLoadedSource: BPRecipieInLoadedSource) => R,
        whenFailedDo: (breakpointInUnbindedSource: BPRecipieInUnresolvedSource) => R): R {
        return this.location.tryGettingLocationInLoadedSource(
            locationInLoadedSource => whenSuccesfulDo(new BPRecipieInLoadedSource(this, locationInLoadedSource)),
            () => whenFailedDo(this));
    }

    public asBreakpointInLoadedSource(): BPRecipieInLoadedSource {
        return this.tryGettingBreakpointInLoadedSource(
            breakpointInLoadedSource => breakpointInLoadedSource,
            () => { throw new Error(`Failed to convert ${this} into a breakpoint in a loaded source`); });
    }

    public asBreakpointWithLoadedSource(source: ILoadedSource<string>): BPRecipieInLoadedSource {
        return new BPRecipieInLoadedSource(this, this.location.asLocationWithLoadedSource(source));
    }
}

export type IBreakpointRecipieInLoadedSource = IBPRecipie<ILoadedSource>;
export type IBreakpointRecipieInUnbindedSource = IBPRecipie<ISourceResolver>;

export type BPRecipie<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp> =
    TResource extends ISourceResolver ? BPRecipieInUnresolvedSource :
    TResource extends ILoadedSource ? BPRecipieInLoadedSource :
    TResource extends IScript ? BPRecipieInScript :
    TResource extends IResourceIdentifier ? BPRecipieInUrl :
    TResource extends URLRegexp ? BPRecipieInUrlRegexp :
    never;

export class BPRecipieInScript<TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit>
    extends MappedBPRecipieCommonLogic<IScript, TBPActionWhenHit> implements IBPRecipie<IScript, TBPActionWhenHit> {

    public atLocation(newLocation: LocationInScript): BPRecipieInScript<TBPActionWhenHit> {
        return new BPRecipieInScript<TBPActionWhenHit>(this.unmappedBpRecipie, newLocation);
    }

    public asBPInUrlRegexpRecipie(): BPRecipieInUrlRegexp<TBPActionWhenHit> {
        const urlRegexp = new URLRegexp(utils.pathToRegex(this.location.script.url));
        return new BPRecipieInUrlRegexp<TBPActionWhenHit>(this.unmappedBpRecipie,
            new LocationInUrlRegexp(urlRegexp, this.location.coordinates));
    }

    public asBPInUrlRecipie(): BPRecipieInUrl<TBPActionWhenHit> {
        const url = this.location.script.runtimeSource.identifier;
        return new BPRecipieInUrl<TBPActionWhenHit>(this.unmappedBpRecipie,
            new LocationInUrl(url, this.location.coordinates));
    }
}

export class BPRecipieInUrl<TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit>
    extends MappedBPRecipieCommonLogic<IResourceIdentifier, TBPActionWhenHit> implements IBPRecipie<IResourceIdentifier, TBPActionWhenHit> {
}

export class BPRecipieInUrlRegexp<TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit>
    extends MappedBPRecipieCommonLogic<URLRegexp, TBPActionWhenHit> implements IBPRecipie<URLRegexp, TBPActionWhenHit> {
}

export class URLRegexp {
    constructor(public readonly textRepresentation: string) { }

    public toString(): string {
        return `BP @ ${this.textRepresentation}`;
    }
}