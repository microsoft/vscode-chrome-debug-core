/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from '../../sources/loadedSource';
import { asyncMap } from '../../../collections/async';
import { promiseDefer, IPromiseDefer } from '../../../../utils';
import { IScriptParsedProvider } from '../../../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';
import { DebuggeeBPRsSetForClientBPRFinder } from '../registries/debuggeeBPRsSetForClientBPRFinder';
import { ValidatedMap } from '../../../collections/validatedMap';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { wrapWithMethodLogger } from '../../../logging/methodsCalledLogger';
import { IBPActionWhenHit } from '../bpActionWhenHit';
import { BPRecipeInScript } from '../baseMappedBPRecipe';
import { LocationInLoadedSource } from '../../locations/location';
import { IScript } from '../../scripts/script';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PrivateTypes } from '../diTypes';
import { BPRecipeAtLoadedSourceSetter } from './bpRecipeAtLoadedSourceLogic';
import { BPRecipesForSourceRetriever } from '../registries/bpRecipesForSourceRetriever';
import { IEventsConsumer, Synchronicity } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { CDTPBreakpoint } from '../../../cdtpDebuggee/cdtpPrimitives';
import { SourceToScriptMapper } from '../../services/sourceToScriptMapper';

class MakeAllEventsAsyncConsumer implements IEventsConsumer {
    public constructor(private readonly _wrappedEventsConsumer: IEventsConsumer) { }

    bpRecipeWasResolved(breakpoint: CDTPBreakpoint, _resolutionSynchronicity: Synchronicity): void {
        return this._wrappedEventsConsumer.bpRecipeWasResolved(breakpoint, Synchronicity.Async);
    }
}

/**
 * Set all the neccesary debuggee breakpoint recipes for a script that was just parsed
 */
@injectable()
export class ExistingBPsForJustParsedScriptSetter {
    private readonly _scriptToBPsAreSetDefer = new ValidatedMap<IScript, IPromiseDefer<void>>();
    private _bpRecipeWasResolvedEventsConsumer: IEventsConsumer | undefined = undefined;

    public readonly withLogging = wrapWithMethodLogger(this);

    constructor(
        @inject(TYPES.IScriptParsedProvider) private readonly _scriptParsedProvider: IScriptParsedProvider,
        @inject(PrivateTypes.DebuggeeBPRsSetForClientBPRFinder) private readonly _debuggeeBPRsSetForClientBPRFinder: DebuggeeBPRsSetForClientBPRFinder,
        @inject(PrivateTypes.BPRecipesForSourceRetriever) private readonly _bpRecipesForSourceRetriever: BPRecipesForSourceRetriever,
        @inject(PrivateTypes.SourceToScriptMapper) private readonly _sourceToScriptMapper: SourceToScriptMapper,
        @inject(PrivateTypes.BPRecipeAtLoadedSourceSetter) private readonly _bpRecipeAtLoadedSourceSetter: BPRecipeAtLoadedSourceSetter) {
        this._scriptParsedProvider.onScriptParsed(scriptParsed => this.withLogging.setBPsForScript(scriptParsed.script));
    }

    public setEventsConsumer(eventsConsumer: IEventsConsumer) {
        if (this._bpRecipeWasResolvedEventsConsumer === undefined) {
            /*
             * At the moment we are using the Sync vs Async parameter to distinguish where the status was updated during a call of setBreakpoints.
             * None of the events from this class come from a setBreakpoints call, so we need to modify them to be marked as Async for the breakpointsUpdater
             * to work properly. TODO: Figure out a better way to handle things instead of doing this
             */
            this._bpRecipeWasResolvedEventsConsumer = new MakeAllEventsAsyncConsumer(eventsConsumer);
        } else {
            throw new Error(`setEventsConsumer was already configured to a different value`);
        }
    }

    public waitUntilBPsAreSet(script: IScript): Promise<void> {
        const doesScriptHaveAnyBPRecipes = script.allSources.find(source => this._bpRecipesForSourceRetriever.bpRecipesForSource(source.identifier).length >= 1);
        if (doesScriptHaveAnyBPRecipes) {
            return this.finishedSettingBPsForScriptDefer(script).promise;
        } else {
            const defer = this._scriptToBPsAreSetDefer.tryGetting(script);
            return Promise.resolve(defer && defer.promise);
        }
    }

    private finishedSettingBPsForScriptDefer(script: IScript): IPromiseDefer<void> {
        return this._scriptToBPsAreSetDefer.getOrAdd(script, () => promiseDefer<void>());
    }

    private async setBPsForScript(justParsedScript: IScript): Promise<void> {
        const defer = this.finishedSettingBPsForScriptDefer(justParsedScript);
        await asyncMap(justParsedScript.allSources, source => this.withLogging.setBPsFromSourceIntoScript(source, justParsedScript));
        defer.resolve();
    }

    private async setBPsFromSourceIntoScript(sourceWhichMayHaveBPs: ILoadedSource, justParsedScript: IScript): Promise<void> {
        const bpRecipesInSource = this._bpRecipesForSourceRetriever.bpRecipesForSource(sourceWhichMayHaveBPs.identifier);

        for (const bpRecipe of bpRecipesInSource) {
            await this.withLogging.setBPFromSourceIntoScriptIfNeeded(bpRecipe, justParsedScript, sourceWhichMayHaveBPs);
        }
    }

    private async setBPFromSourceIntoScriptIfNeeded(bpRecipe: BPRecipeInSource<IBPActionWhenHit>, justParsedScript: IScript, sourceWhichMayHaveBPs: ILoadedSource<string>) {
        const debuggeeBPRecipes = this._debuggeeBPRsSetForClientBPRFinder.findDebuggeeBPRsSet(bpRecipe);
        const bpRecipeResolved = bpRecipe.resolvedWithLoadedSource(sourceWhichMayHaveBPs);
        const runtimeLocationsWhichAlreadyHaveThisBPR = debuggeeBPRecipes.map(recipe => recipe.runtimeSourceLocation);

        const manyBPRecipesInScripts = await this._sourceToScriptMapper.mapBPRecipe(bpRecipeResolved, script => script === justParsedScript);
        await this.withLogging.setBPRsInScriptIfNeeded(manyBPRecipesInScripts, runtimeLocationsWhichAlreadyHaveThisBPR);
    }

    private async setBPRsInScriptIfNeeded(bprInScripts: BPRecipeInScript[], runtimeLocationsWhichAlreadyHaveThisBPR: LocationInLoadedSource[]) {
        for (const bprInScript of bprInScripts) {
            await this.withLogging.setBPRInScriptFromSourceIntoScriptIfNeeded(bprInScript, runtimeLocationsWhichAlreadyHaveThisBPR);
        }
    }

    private async setBPRInScriptFromSourceIntoScriptIfNeeded(bprInScript: BPRecipeInScript, runtimeLocationsWhichAlreadyHaveThisBPR: LocationInLoadedSource[]): Promise<void> {
        const bprInRuntimeSource = bprInScript.mappedToRuntimeSource();

        // Was the breakpoint already set for the runtime source of this script? (This will happen if we include the same script twice in the same debuggee)
        if (!runtimeLocationsWhichAlreadyHaveThisBPR.some(location => location.isEquivalentTo(bprInRuntimeSource.location))) {
            if (this._bpRecipeWasResolvedEventsConsumer === undefined) {
                throw new Error(`Expected the events consumer to be configured by now`);
            }

            await this._bpRecipeAtLoadedSourceSetter.addBreakpointAtLoadedSource(bprInRuntimeSource, this._bpRecipeWasResolvedEventsConsumer);
        }
    }

    public toString(): string {
        return `ExistingBPsForJustParsedScriptSetter`;
    }
}