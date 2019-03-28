/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from '../../sources/loadedSource';
import { asyncMap } from '../../../collections/async';
import { promiseDefer, IPromiseDefer } from '../../../../utils';
import { IBPRecipeAtLoadedSourceSetter } from './bpRecipeAtLoadedSourceLogic';
import { IScriptParsedProvider } from '../../../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';
import { DebuggeeBPRsSetForClientBPRFinder } from '../registries/debuggeeBPRsSetForClientBPRFinder';
import { CurrentBPRecipesForSourceRegistry } from '../registries/currentBPRecipesForSourceRegistry';
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

/**
 * Set all the neccesary debuggee breakpoint recipes for a script that was just parsed
 */
@injectable()
export class ExistingBPsForJustParsedScriptSetter {
    private readonly _scriptToBPsAreSetDefer = new ValidatedMap<IScript, IPromiseDefer<void>>();

    public readonly withLogging = wrapWithMethodLogger(this);

    constructor(
        @inject(TYPES.IScriptParsedProvider) private readonly _scriptParsedProvider: IScriptParsedProvider,
        private readonly _debuggeeBPRsSetForClientBPRFinder: DebuggeeBPRsSetForClientBPRFinder,
        private readonly _clientCurrentBPRecipesRegistry: CurrentBPRecipesForSourceRegistry,
        @inject(PrivateTypes.BPRecipeAtLoadedSourceSetter) private readonly _breakpointsInLoadedSource: IBPRecipeAtLoadedSourceSetter) {
        this._scriptParsedProvider.onScriptParsed(scriptParsed => this.withLogging.setBPsForScript(scriptParsed.script));
    }

    public waitUntilBPsAreSet(script: IScript): Promise<void> {
        const doesScriptHaveAnyBPRecipes = script.allSources.find(source => this._clientCurrentBPRecipesRegistry.bpRecipesForSource(source.identifier).length >= 1);
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
        const bpRecipesInSource = this._clientCurrentBPRecipesRegistry.bpRecipesForSource(sourceWhichMayHaveBPs.identifier);

        for (const bpRecipe of bpRecipesInSource) {
            await this.withLogging.setBPFromSourceIntoScriptIfNeeded(bpRecipe, justParsedScript, sourceWhichMayHaveBPs);
        }
    }

    private async setBPFromSourceIntoScriptIfNeeded(bpRecipe: BPRecipeInSource<IBPActionWhenHit>, justParsedScript: IScript, sourceWhichMayHaveBPs: ILoadedSource<string>) {
        const debuggeeBPRecipes = this._debuggeeBPRsSetForClientBPRFinder.findDebuggeeBPRsSet(bpRecipe);
        const bpRecepieResolved = bpRecipe.resolvedWithLoadedSource(sourceWhichMayHaveBPs);
        const runtimeLocationsWhichAlreadyHaveThisBPR = debuggeeBPRecipes.map(recipe => recipe.runtimeSourceLocation);

        const bprInScripts = bpRecepieResolved.mappedToScript().filter(b => b.location.script === justParsedScript);
        await this.withLogging.setBPRsInScriptIfNeeded(bprInScripts, runtimeLocationsWhichAlreadyHaveThisBPR, bpRecipe);
    }

    private async setBPRsInScriptIfNeeded(bprInScripts: BPRecipeInScript[], runtimeLocationsWhichAlreadyHaveThisBPR: LocationInLoadedSource[], bpRecipe: BPRecipeInSource<IBPActionWhenHit>) {
        for (const bprInScript of bprInScripts) {
            await this.withLogging.setBPRInScriptFromSourceIntoScriptIfNeeded(bprInScript, runtimeLocationsWhichAlreadyHaveThisBPR, bpRecipe);
        }
    }

    private async setBPRInScriptFromSourceIntoScriptIfNeeded(bprInScript: BPRecipeInScript, runtimeLocationsWhichAlreadyHaveThisBPR: LocationInLoadedSource[], bpRecipe: BPRecipeInSource<IBPActionWhenHit>): Promise<void> {
        const bprInRuntimeSource = bprInScript.mappedToRuntimeSource();

        // Was the breakpoint already set for the runtime source of this script? (This will happen if we include the same script twice in the same debuggee)
        if (!runtimeLocationsWhichAlreadyHaveThisBPR.some(location => location.isEquivalentTo(bprInRuntimeSource.location))) {
            await this._breakpointsInLoadedSource.addBreakpointAtLoadedSource(bprInRuntimeSource);
        }
    }

    public toString(): string {
        return `ExistingBPsForJustParsedScriptSetter`;
    }
}