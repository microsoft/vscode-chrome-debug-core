import { BPRecipieInLoadedSource, BPRecipie } from './bpRecipie';
import { ConditionalBreak, AlwaysBreak } from './bpActionWhenHit';
import { IBreakpoint } from './breakpoint';
import { ScriptOrSourceOrIdentifierOrUrlRegexp, LocationInScript, Coordinates } from '../locations/location';
import { ISourceResolver } from '../sources/sourceResolver';
import { chromeUtils, logger } from '../../..';
import { ColumnNumber, LineNumber } from '../locations/subtypes';
import { RangeInScript } from '../locations/rangeInScript';
import { BreakpointsRegistry } from './breakpointsRegistry';
import { PausedEvent } from '../../target/events';
import { VoteCommonLogic, VoteRelevance, Vote, Abstained } from '../../communication/collaborativeDecision';
import { inject, injectable } from 'inversify';
import { ITargetBreakpoints } from '../../target/cdtpTargetBreakpoints';
import { IBreakpointFeaturesSupport } from '../../target/breakpointFeaturesSupport';
import { TYPES } from '../../dependencyInjection.ts/types';

export type Dummy = VoteRelevance; // If we don't do this the .d.ts doesn't include VoteRelevance and the compilation fails. Remove this when the issue disappears...

export class HitBreakpoint extends VoteCommonLogic<void> {
    public readonly relevance = VoteRelevance.NormalVote;

    public execute(): Promise<void> {
        throw new Error('Method not implemented.');
    }
}

export interface IBreakpointsInLoadedSource {
    addBreakpointForLoadedSource(bpRecipie: BPRecipieInLoadedSource<ConditionalBreak | AlwaysBreak>): Promise<IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>[]>;
}

@injectable()
export class BPRecipieInLoadedSourceLogic implements IBreakpointsInLoadedSource {
    private readonly doesTargetSupportColumnBreakpointsCached: Promise<boolean>;

    public async askForInformationAboutPaused(paused: PausedEvent): Promise<Vote<void>> {
        if (paused.hitBreakpoints && paused.hitBreakpoints.length > 0) {
            // TODO DIEGO: Improve this to consider breakpoints where we shouldn't pause
            return new HitBreakpoint();
        } else {
            return new Abstained();
        }
    }

    public async addBreakpointForLoadedSource(bpRecipie: BPRecipieInLoadedSource<ConditionalBreak | AlwaysBreak>): Promise<IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>[]> {
        const bpInScriptRecipie = bpRecipie.asBPInScriptRecipie();
        const bestLocation = await this.considerColumnAndSelectBestBPLocation(bpInScriptRecipie.location);
        const bpRecipieInBestLocation = bpInScriptRecipie.atLocation(bestLocation);

        const runtimeSource = bpInScriptRecipie.location.script.runtimeSource;
        this._breakpointRegistry.registerBPRecipie(bpRecipie);

        let breakpoints: IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>[];
        if (!runtimeSource.doesScriptHasUrl()) {
            breakpoints = [await this._targetBreakpoints.setBreakpoint(bpRecipieInBestLocation)];
        } else if (runtimeSource.identifier.isLocalFilePath()) {
            breakpoints = await this._targetBreakpoints.setBreakpointByUrlRegexp(bpRecipieInBestLocation.asBPInUrlRegexpRecipie());
        } else { // The script has a URL and it's not a local file path, so we can leave it as-is
            breakpoints = await this._targetBreakpoints.setBreakpointByUrl(bpRecipieInBestLocation.asBPInUrlRecipie());
        }

        breakpoints.forEach(breakpoint => this._breakpointRegistry.registerBreakpointAsBinded(breakpoint));
        return breakpoints;
    }

    public removeBreakpoint(bpRecipie: BPRecipie<ISourceResolver>): Promise<void> {
        return this._targetBreakpoints.removeBreakpoint(bpRecipie);
    }

    private async considerColumnAndSelectBestBPLocation(location: LocationInScript): Promise<LocationInScript> {
        if (await this.doesTargetSupportColumnBreakpointsCached) {
            const thisLineStart = new Coordinates(location.coordinates.lineNumber, 0 as ColumnNumber);
            const nextLineStart = new Coordinates((location.coordinates.lineNumber + 1) as LineNumber, 0 as ColumnNumber);
            const thisLineRange = new RangeInScript(location.script, thisLineStart, nextLineStart);

            const possibleLocations = await this._targetBreakpoints.getPossibleBreakpoints(thisLineRange);

            if (possibleLocations.length > 0) {
                const bestLocation = chromeUtils.selectBreakpointLocation(location.lineNumber, location.columnNumber, possibleLocations);
                logger.verbose(`PossibleBreakpoints: Best location for ${location} is ${bestLocation}`);
                return bestLocation;
            }
        }

        return location;
    }

    constructor(
        @inject(TYPES.IBreakpointFeaturesSupport) private readonly _breakpointFeaturesSupport: IBreakpointFeaturesSupport,
        private readonly _breakpointRegistry: BreakpointsRegistry,
        @inject(TYPES.CDTPDebugger) private readonly _targetBreakpoints: ITargetBreakpoints) {
        this.doesTargetSupportColumnBreakpointsCached = this._breakpointFeaturesSupport.supportsColumnBreakpoints;
    }
}