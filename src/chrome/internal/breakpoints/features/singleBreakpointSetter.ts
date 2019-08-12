import { inject, injectable } from 'inversify';
import { PrivateTypes } from '../diTypes';

import { BPRecipeAtLoadedSourceSetter } from './bpRecipeAtLoadedSourceLogic';
import { BPRecipeStatusChanged } from '../registries/bpRecipeStatusCalculator';
import { Listeners } from '../../../communication/listeners';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { BPRecipe } from '../bpRecipe';
import { BreakpointsEventSystem } from './breakpointsEventSystem';
import { BPRecipesForSourceRetriever } from '../registries/bpRecipesForSourceRetriever';
import { ExistingBPsForJustParsedScriptSetter } from './existingBPsForJustParsedScriptSetter';
import { IEventsConsumer, BPRecipeWasResolved, BPRecipeInSourceWasResolved } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { IBPActionWhenHit } from '../bpActionWhenHit';
import { ISource } from '../../sources/source';
import { BPAtNotLoadedScriptViaHeuristicSetter } from './bpAtNotLoadedScriptViaHeuristicSetter';
import { OnPausedForBreakpointCallback } from './onPausedForBreakpointCallback';
import { InternalError } from '../../../utils/internalError';

export type BPRecipeInSourceWasResolvedCallback = (event: BPRecipeInSourceWasResolved) => void;
export type BPRecipeWasResolvedCallback = (event: BPRecipeWasResolved) => void;

export interface ISingleBreakpointSetter {
    readonly bpRecipeStatusChangedListeners: Listeners<BPRecipeStatusChanged, void>;

    setOnPausedForBreakpointCallback(onPausedForBreakpointCallback: OnPausedForBreakpointCallback): void;
    setBPRecipeWasResolvedCallback(callback: BPRecipeWasResolvedCallback | BPRecipeInSourceWasResolvedCallback): void;

    addBPRecipe(requestedBP: BPRecipeInSource): Promise<void>;
    removeBPRecipe(clientBPRecipe: BPRecipeInSource): Promise<void>;
}

const defaultBPRecipeWasResolvedCallback: BPRecipeInSourceWasResolvedCallback = () => { throw new InternalError('error.singleBreakpointSetter.noCallback', 'No callback was specified for BPRecipeWasResolvedCallback'); };

@injectable()
export class SingleBreakpointSetter implements ISingleBreakpointSetter {
    public readonly clientBPRecipeAddedListeners = new Listeners<BPRecipeInSource, void>();
    public readonly clientBPRecipeRemovedListeners = new Listeners<BPRecipeInSource, void>();
    public readonly bpRecipeStatusChangedListeners = new Listeners<BPRecipeStatusChanged, void>();

    private _bpRecipeWasResolvedCallback = defaultBPRecipeWasResolvedCallback;

    public readonly _bpRecipeWasResolvedEventsConsumer: IEventsConsumer = {
        bpRecipeWasResolved: (breakpoint, resolutionSynchronicity) =>
            {
                const breakpointInSource = breakpoint.mappedToSource();
                return this._bpRecipeWasResolvedCallback(new BPRecipeInSourceWasResolved(breakpointInSource, breakpoint.actualLocation, resolutionSynchronicity));
            }
    };

    public constructor(
        @inject(PrivateTypes.BPRecipeAtLoadedSourceSetter) private readonly _breakpointsInLoadedSource: BPRecipeAtLoadedSourceSetter,
        @inject(PrivateTypes.IBreakpointsEventsListener) private readonly _breakpointsEventSystem: BreakpointsEventSystem,
        @inject(PrivateTypes.BPRecipesForSourceRetriever) private readonly _bpRecipesForSourceRetriever: BPRecipesForSourceRetriever,
        @inject(PrivateTypes.BPAtNotLoadedScriptViaHeuristicSetter) private readonly _bpAtNotLoadedScriptViaHeuristicSetter: BPAtNotLoadedScriptViaHeuristicSetter,
        @inject(PrivateTypes.ExistingBPsForJustParsedScriptSetter) private readonly _existingBPsForJustParsedScriptSetter: ExistingBPsForJustParsedScriptSetter) {
        this._breakpointsEventSystem.setDependencies(this, this._breakpointsInLoadedSource);
        this._existingBPsForJustParsedScriptSetter.setEventsConsumer(this._bpRecipeWasResolvedEventsConsumer);
    }

    public setBPRecipeWasResolvedCallback(callback: (event: BPRecipeInSourceWasResolved) => void): void {
        if (this._bpRecipeWasResolvedCallback === defaultBPRecipeWasResolvedCallback) {
            this._bpRecipeWasResolvedCallback = callback;
        } else {
            throw new InternalError('error.singleBreakpointSetter.callbackAlreadyConfigured', 'BPRecipeWasResolvedCallback was already configured to a different value');
        }
    }

    public setOnPausedForBreakpointCallback(onPausedForBreakpointCallback: OnPausedForBreakpointCallback): void {
        this._breakpointsInLoadedSource.setOnPausedForBreakpointCallback(onPausedForBreakpointCallback);
    }

    public async addBPRecipe(requestedBP: BPRecipeInSource): Promise<void> {
        this._bpRecipesForSourceRetriever.bpRecipeIsBeingAdded(requestedBP);
        this.clientBPRecipeAddedListeners.call(requestedBP);

        await this.setAlreadyRegisteredBPRecipe(requestedBP, async () => {
            await this._bpAtNotLoadedScriptViaHeuristicSetter.addBPRecipe(requestedBP, this._bpRecipeWasResolvedEventsConsumer);
        });
    }

    private async setAlreadyRegisteredBPRecipe(requestedBP: BPRecipeInSource<IBPActionWhenHit>, whenNotResolvedAction: () => void): Promise<void> {
        await requestedBP.tryResolving(async (resolvedRequestedBP) => {
            await this._breakpointsInLoadedSource.addBreakpointAtLoadedSource(resolvedRequestedBP, this._bpRecipeWasResolvedEventsConsumer);
        }, whenNotResolvedAction);
    }

    public async removeBPRecipe(clientBPRecipe: BPRecipe<ISource>): Promise<void> {
        await this._bpAtNotLoadedScriptViaHeuristicSetter.removeBPRecipeIfNeeded(clientBPRecipe);
        await this._breakpointsInLoadedSource.removeDebuggeeBPRs(clientBPRecipe);
        this.clientBPRecipeRemovedListeners.call(clientBPRecipe);
        this._bpRecipesForSourceRetriever.bpRecipeWasRemoved(clientBPRecipe);
    }

    public toString(): string {
        return `SingleBreakpointSetter`;
    }
}