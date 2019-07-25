/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { BPRecipeInSource } from '../bpRecipeInSource';
import { IBPActionWhenHit } from '../bpActionWhenHit';
import { BaseSourceMapTransformer } from '../../../../transformers/baseSourceMapTransformer';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { MappedSourcesMapper } from '../../scripts/sourcesMapper';
import { IHasSourceMappingInformation } from '../../scripts/IHasSourceMappingInformation';
import { IDebuggeeBreakpointsSetter, IEventsConsumer } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { mapToUrlRegexp, BPRecipeInUrlRegexp } from '../baseMappedBPRecipe';
import { LocationInUrl, LocationInLoadedSource, Position } from '../../locations/location';
import { CDTPScriptUrl } from '../../sources/resourceIdentifierSubtypes';
import { IResourceIdentifier } from '../../sources/resourceIdentifier';
import { IdentifiedLoadedSource } from '../../sources/identifiedLoadedSource';
import { SourceMap } from '../../../../sourceMaps/sourceMap';
import { ValidatedMap } from '../../../collections/validatedMap';
import { ILoadedSource, ImplementsLoadedSource, SourceScriptRelationship, ContentsLocation, IScriptMapper } from '../../sources/loadedSource';

/**
 * When the user sets a breakpoint on a source file that is not associated with any loaded script, we use this heuristic to set a breakpoint
 * directly on that file, or if we find a source-map related to that file, we apply that source-mapping, and we set the breakpoint in the
 * place where the source-map tells us. This will make breakpoints on file:/// urls and local file paths work without break-on-load on both
 * chrome-debug and node-debug
 */
@injectable()
export class BPAtNotLoadedScriptViaHeuristicSetter {
    private readonly _bprToHeuristicBPR = new ValidatedMap<BPRecipeInSource, BPRecipeInUrlRegexp>();

    public constructor(
        @inject(TYPES.BaseSourceMapTransformer) private readonly _sourceMapTransformer: BaseSourceMapTransformer,
        @inject(TYPES.IDebuggeeBreakpointsSetter) private readonly _targetBreakpoints: IDebuggeeBreakpointsSetter) { }

    public async addBPRecipe(requestedBP: BPRecipeInSource, eventsConsumer: IEventsConsumer): Promise<void> {
        const location = await this.getBPRInUrlRegexpPosition(requestedBP);

        // The runtimeLocation is only used in ExistingBPsForJustParsedScriptSetter which is not needed for the heuristic, so we pass an unavailable loaded source
        const runtimeLocation = new LocationInLoadedSource(new NoLoadedSourceAvailable(), Position.origin);

        const heuristicBPRecipe = mapToUrlRegexp(requestedBP, location.url.textRepresentation, location.position, runtimeLocation);

        this._bprToHeuristicBPR.set(requestedBP, heuristicBPRecipe);
        await this._targetBreakpoints.setBreakpointByUrlRegexp(heuristicBPRecipe, eventsConsumer);
    }

    public async removeBPRecipeIfNeeded(requestedBP: BPRecipeInSource): Promise<void> {
        const heuristicBPR = this._bprToHeuristicBPR.tryGetting(requestedBP);
        if (heuristicBPR !== undefined) {
            await this._targetBreakpoints.removeBreakpoint(heuristicBPR);
            this._bprToHeuristicBPR.delete(requestedBP);
        }
    }

    private async getBPRInUrlRegexpPosition(requestedBP: BPRecipeInSource<IBPActionWhenHit>): Promise<LocationInUrl> {
        const sourceIdentifier = requestedBP.location.resource.sourceIdentifier;
        const sourceMap = await this._sourceMapTransformer.getSourceMapFromAuthoredPath(sourceIdentifier);
        if (sourceMap !== null) {
            const script = new SourceWithSourceMap(sourceMap);
            const sourceMapper = MappedSourcesMapper.tryParsing(script, sourceMap);
            const mappedLocation = sourceMapper.getPositionInScript(requestedBP.location);
            return new LocationInUrl(<IResourceIdentifier<CDTPScriptUrl>>sourceMap.generatedPath, mappedLocation.enclosingRange.range.start);
        }

        // We don't know if this cast is correct or not. If it's not, the breakpoint will not bind, as designed
        return new LocationInUrl(<IResourceIdentifier<CDTPScriptUrl>>sourceIdentifier, requestedBP.location.position);
    }
}

/**
 * We use this file when we have a typescript file, for which we found a source-map using the EagerSourceMapTransformer before the correspondant script
 * was loaded by CDTP, so we need to use the source-mapping logic, yet we don't have an instance of IScript to do it. We use this instance instead,
 * that will correctly help map typescript files to javascript files for non .html files.
 */
export class SourceWithSourceMap implements IHasSourceMappingInformation {
    public readonly runtimeSource = new NoLoadedSourceAvailable();
    public readonly developmentSource = new NoLoadedSourceAvailable();

    public constructor(private readonly _sourceMap: SourceMap) { }

    public get mappedSources(): IdentifiedLoadedSource<string>[] {
        // It doesn't seem this method is needed when calling sourceMapper.getPositionInScript, so we don't need to implement it
        throw new Error(localize('error.sourceWithSourceMap.mappedSources.notImplemented', 'Not yet implemented: SourceWithSourceMap.mappedSources'));
    }

    public get startPositionInSource(): Position {
        return Position.origin; // TODO: Try to figure out an heuristic for .html files
    }

    public toString(): string {
        return `Source with map: ${this._sourceMap.generatedPath}`;
    }
}

/**
 * We need a runtime location to create a BPRecipeInRegexp. We don't have one, so we pass a this instance instead.
 */
class NoLoadedSourceAvailable implements ILoadedSource<CDTPScriptUrl> {
    [ImplementsLoadedSource]: 'ILoadedSource';

    public get identifier(): IResourceIdentifier<CDTPScriptUrl> {
        return this.throwError();
    }

    public get url(): CDTPScriptUrl {
        return this.throwError();
    }

    public get sourceScriptRelationship(): SourceScriptRelationship {
        return this.throwError();
    }

    public get contentsLocation(): ContentsLocation {
        return this.throwError();
    }

    public doesScriptHasUrl(): boolean {
        return this.throwError();
    }

    public isMappedSource(): boolean {
        return this.throwError();
    }

    public scriptMapper(): IScriptMapper {
        return this.throwError();
    }

    public isEquivalentTo(_right: this): boolean {
        return this.throwError();
    }

    private throwError(): never {
        throw new Error(localize('error.noLoadedSourceAvailable.invalidMethod', `Can't request this when the runtime source is not available`));
    }
}
