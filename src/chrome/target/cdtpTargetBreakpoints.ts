import { BPRecipieInScript, BPRecipieInUrl, BPRecipieInUrlRegexp, BPRecipie, IBPRecipie, URLRegexp } from '../internal/breakpoints/bpRecipie';
import { AlwaysBreak, ConditionalBreak } from '../internal/breakpoints/bpActionWhenHit';
import { BreakpointInScript, BreakpointInUrl, BreakpointInUrlRegexp, Breakpoint } from '../internal/breakpoints/breakpoint';
import { RangeInScript } from '../internal/locations/rangeInScript';
import { LocationInScript, ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { Crdp, inject } from '../..';
import { BreakpointIdRegistry } from './breakpointIdRegistry';
import { TYPES } from '../dependencyInjection.ts/types';
import { asyncMap } from '../collections/async';
import { IScript } from '../internal/scripts/script';
import { IResourceIdentifier } from '../internal/sources/resourceIdentifier';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';
import { CDTPLocationParser } from './cdtpLocationParser';

export interface ITargetBreakpoints {
    setBreakpoint(bpRecipie: BPRecipieInScript<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInScript>;
    setBreakpointByUrl(bpRecipie: BPRecipieInUrl<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrl[]>;
    setBreakpointByUrlRegexp(bpRecipie: BPRecipieInUrlRegexp<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrlRegexp[]>;
    getPossibleBreakpoints(rangeInScript: RangeInScript): Promise<LocationInScript[]>;
    removeBreakpoint(bpRecipie: BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): Promise<void>;
}

interface BreakpointClass<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp> {
    new(recipie: BPRecipie<TResource>, actualLocation: LocationInScript): Breakpoint<TResource>;
}

export class CDTPTargetBreakpoints extends CDTPEventsEmitterDiagnosticsModule<Crdp.DebuggerApi> implements ITargetBreakpoints {
    protected readonly api: Crdp.DebuggerApi = this.protocolApi.Debugger;

    public readonly onBreakpointResolved = this.addApiListener('breakpointResolved', async (params: Crdp.Debugger.BreakpointResolvedEvent) => {
        const bpRecipie = this._breakpointIdRegistry.getRecipieByBreakpointId(params.breakpointId);
        const breakpoint = new Breakpoint(bpRecipie,
            await this.toLocationInScript(params.location));
        return breakpoint;
    });

    public async setBreakpoint(bpRecipie: BPRecipieInScript<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInScript> {
        const condition = this.getBPRecipieCondition(bpRecipie);

        const response = await this.api.setBreakpoint({ location: this.toCrdpLocation(bpRecipie.location), condition });

        // We need to call registerRecipie sync with the response, before any awaits so if we get an event witha breakpointId we'll be able to resolve it properly
        this._breakpointIdRegistry.registerRecipie(response.breakpointId, bpRecipie);

        return this.toBreakpointInScript(bpRecipie, response);
    }

    public async setBreakpointByUrl(bpRecipie: BPRecipieInUrl<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrl[]> {
        const condition = this.getBPRecipieCondition(bpRecipie);
        const url = bpRecipie.location.resource.textRepresentation;
        const location = bpRecipie.location.coordinates;

        const response = await this.api.setBreakpointByUrl({ url, lineNumber: location.lineNumber, columnNumber: location.columnNumber, condition });

        // We need to call registerRecipie sync with the response, before any awaits so if we get an event witha breakpointId we'll be able to resolve it properly
        this._breakpointIdRegistry.registerRecipie(response.breakpointId, bpRecipie);

        return Promise.all(response.locations.map(cdtpLocation => this.toBreakpointInUrl(bpRecipie, cdtpLocation)));
    }

    public async setBreakpointByUrlRegexp(bpRecipie: BPRecipieInUrlRegexp<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrlRegexp[]> {
        const condition = this.getBPRecipieCondition(bpRecipie);
        const urlRegex = bpRecipie.location.resource.textRepresentation;
        const location = bpRecipie.location.coordinates;

        const response = await this.api.setBreakpointByUrl({ urlRegex, lineNumber: location.lineNumber, columnNumber: location.columnNumber, condition });

        // We need to call registerRecipie sync with the response, before any awaits so if we get an event witha breakpointId we'll be able to resolve it properly
        this._breakpointIdRegistry.registerRecipie(response.breakpointId, bpRecipie);

        return Promise.all(response.locations.map(cdtpLocation => this.toBreakpointInUrlRegexp(bpRecipie, cdtpLocation)));
    }

    public async getPossibleBreakpoints(rangeInScript: RangeInScript): Promise<LocationInScript[]> {
        const response = await this.api.getPossibleBreakpoints({
            start: this.toCrdpLocation(rangeInScript.startInScript),
            end: this.toCrdpLocation(rangeInScript.endInScript)
        });

        return asyncMap(response.locations, async location => await this.toLocationInScript(location));
    }

    public async removeBreakpoint(bpRecipie: BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): Promise<void> {
        await this.api.removeBreakpoint({ breakpointId: this._breakpointIdRegistry.getBreakpointId(bpRecipie) });
        this._breakpointIdRegistry.unregisterRecipie(bpRecipie);
    }

    private getBPRecipieCondition(bpRecipie: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp, AlwaysBreak | ConditionalBreak>): string | undefined {
        return bpRecipie.bpActionWhenHit.basedOnTypeDo({
            alwaysBreak: () => undefined,
            conditionalBreak: conditionalBreak => conditionalBreak.expressionOfWhenToBreak
        });
    }

    private async toBreakpointInUrlRegexp(bpRecipie: BPRecipieInUrlRegexp, actualLocation: Crdp.Debugger.Location): Promise<BreakpointInUrlRegexp> {
        return this.toBreakpoinInResource<URLRegexp>(BreakpointInUrlRegexp, bpRecipie, actualLocation);
    }

    private async toBreakpoinInResource<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp>(classToUse: BreakpointClass<TResource>,
        bpRecipie: BPRecipie<TResource>, actualLocation: Crdp.Debugger.Location): Promise<Breakpoint<TResource>> {
        const breakpoint = new classToUse(bpRecipie, await this.toLocationInScript(actualLocation));
        return breakpoint;
    }

    private async toBreakpointInScript(bpRecipie: BPRecipieInScript, params: Crdp.Debugger.SetBreakpointResponse): Promise<BreakpointInScript> {
        return this.toBreakpoinInResource<IScript>(BreakpointInScript, bpRecipie, params.actualLocation);
    }

    private async toBreakpointInUrl(bpRecipie: BPRecipieInUrl, actualLocation: Crdp.Debugger.Location): Promise<BreakpointInUrl> {
        return this.toBreakpoinInResource<IResourceIdentifier>(BreakpointInUrl, bpRecipie, actualLocation);
    }

    private toCrdpLocation(location: LocationInScript): Crdp.Debugger.Location {
        return {
            scriptId: this._scriptsRegistry.getCrdpId(location.script),
            lineNumber: location.lineNumber,
            columnNumber: location.columnNumber
        };
    }

    public toLocationInScript(location: Crdp.Debugger.Location): Promise<LocationInScript> {
        return this._cdtpLocationParser.getScriptLocation(location);
    }

    constructor(
        @inject(TYPES.CrdpApi) protected readonly protocolApi: Crdp.ProtocolApi,
        @inject(TYPES.CDTPLocationParser) private readonly _cdtpLocationParser: CDTPLocationParser,
        @inject(TYPES.BreakpointIdRegistry) private readonly _breakpointIdRegistry: BreakpointIdRegistry,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) {
        super();
    }
}
