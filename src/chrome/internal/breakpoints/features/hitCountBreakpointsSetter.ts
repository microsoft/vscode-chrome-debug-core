/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BPRecipeInSource } from '../bpRecipeInSource';
import { PauseOnHitCount, AlwaysPause } from '../bpActionWhenHit';
import { ValidatedMap } from '../../../collections/validatedMap';
import { HitCountConditionParser } from './hitCountConditionParser';
import { BaseNotifyClientOfPause, IActionToTakeWhenPaused, BasePauseShouldBeAutoResumed } from '../../features/actionToTakeWhenPaused';
import { ReasonType } from '../../../stoppedEvent';
import { injectable, inject } from 'inversify';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PrivateTypes } from '../diTypes';
import { IDebuggeeExecutionController } from '../../../cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { printClassDescription } from '../../../utils/printing';
import { SingleBreakpointSetter, ISingleBreakpointSetter } from './singleBreakpointSetter';
import { IBPRecipeStatus, ImplementsBPRecipeStatus } from '../bpRecipeStatus';
import { Listeners } from '../../../communication/listeners';
import { OnPausedForBreakpointCallback } from './bpRecipeAtLoadedSourceLogic';
import { BPRecipeStatusChanged } from '../registries/bpRecipeStatusCalculator';
import { LocationInLoadedSource } from '../../locations/location';

@printClassDescription
export class HitAndSatisfiedHitCountBreakpoint extends BaseNotifyClientOfPause {
    protected reason: ReasonType = 'breakpoint';

    constructor(protected readonly _eventsToClientReporter: IEventsToClientReporter) {
        super();
    }
}

@printClassDescription
export class HitCountBreakpointWhenConditionWasNotSatisfied extends BasePauseShouldBeAutoResumed {
    public constructor(
        protected readonly _debuggeeExecutionControl: IDebuggeeExecutionController) {
        super();
    }
}

class HitCountBreakpointData {
    private readonly _shouldPauseCondition = new HitCountConditionParser(this.hitCountBPRecipe.bpActionWhenHit.pauseOnHitCondition).parse();

    private _currentHitCount = 0;

    constructor(
        public readonly hitCountBPRecipe: HitCountBPRecipe,
        public readonly underlyingBPRecipe: BPRecipeInSource<AlwaysPause>) {
    }

    public shouldPauseForBreakpoint(): boolean {
        return this._shouldPauseCondition(++this._currentHitCount);
    }

    public toString(): string {
        return `Pause when: ${this._shouldPauseCondition}, current: hits ${this._currentHitCount}`;
    }
}

class HitCountBPRecipeStatus implements IBPRecipeStatus {
    [ImplementsBPRecipeStatus] = 'ImplementsBPRecipeStatus';

    public constructor(
        public readonly _hitCountBPRecipe: HitCountBPRecipe,
        private readonly _underlyingBPRecipeStatus: IBPRecipeStatus) { }

    public get recipe(): BPRecipeInSource {
        return this._hitCountBPRecipe;
    }

    public get statusDescription(): string {
        return this._underlyingBPRecipeStatus.statusDescription;
    }

    public isVerified(): boolean {
        return this._underlyingBPRecipeStatus.isVerified();
    }

    public ifHasActualLocation<T>(ifHasAction: (actualLocation: LocationInLoadedSource) => T, ifDoesNotHaveAction: () => T): T {
        return this._underlyingBPRecipeStatus.ifHasActualLocation(ifHasAction, ifDoesNotHaveAction);
    }

    public toString(): string {
        return this.statusDescription;
    }
}

export type HitCountBPRecipe = BPRecipeInSource<PauseOnHitCount>;

/**
 * Implements the hit count breakpoints feature
 */
@injectable()
export class HitCountBreakpointsSetter implements ISingleBreakpointSetter {
    public readonly bpRecipeStatusChangedListeners = new Listeners<BPRecipeStatusChanged, void>();

    private readonly bpRecipetoData = new ValidatedMap<HitCountBPRecipe, HitCountBreakpointData>();
    private readonly underlyingToBPRecipe = new ValidatedMap<BPRecipeInSource, HitCountBPRecipe>();

    constructor(
        @inject(PrivateTypes.SingleBreakpointSetterForHitCountBreakpoints) private readonly _singleBreakpointSetter: SingleBreakpointSetter,
        @inject(TYPES.IDebuggeeExecutionController) private readonly _debuggeeExecutionControl: IDebuggeeExecutionController) {
    }

    public setOnPausedForBreakpointCallback(onPausedForBreakpointCallback: OnPausedForBreakpointCallback): void {
        this._singleBreakpointSetter.bpRecipeStatusChangedListeners.add(bpRecipeStatus => this.onUnderlyingBPRecipeStatusChange(bpRecipeStatus));
        this._singleBreakpointSetter.setOnPausedForBreakpointCallback(bpRecipes => this.onBreakpointHit(bpRecipes, onPausedForBreakpointCallback));
    }

    public async addBPRecipe(bpRecipe: HitCountBPRecipe): Promise<void> {
        const underlyingBPRecipe = bpRecipe.withAlwaysPause();
        this.bpRecipetoData.set(bpRecipe,
            new HitCountBreakpointData(bpRecipe, underlyingBPRecipe));
        this.underlyingToBPRecipe.set(underlyingBPRecipe, bpRecipe);

        const resolvedUnderlyingBPRecipe = this.underlyingBPRecipe(bpRecipe);
        return await this._singleBreakpointSetter.addBPRecipe(resolvedUnderlyingBPRecipe);
    }

    public async removeBPRecipe(bpRecipe: HitCountBPRecipe): Promise<void> {
        await this._singleBreakpointSetter.removeBPRecipe(this.underlyingBPRecipe(bpRecipe));
        const data = this.bpRecipetoData.get(bpRecipe);
        this.bpRecipetoData.delete(bpRecipe);
        this.underlyingToBPRecipe.delete(data.underlyingBPRecipe);
    }

    public async onBreakpointHit(underlyingBPRecipes: BPRecipeInSource[], onPausedForBreakpointCallback: OnPausedForBreakpointCallback): Promise<IActionToTakeWhenPaused> {
        const bpRecipes = underlyingBPRecipes.map(underlyingBPRecipe => this.underlyingToBPRecipe.get(underlyingBPRecipe));
        const satisfiedBPRecipes = bpRecipes.filter(bpRecipe => this.bpRecipetoData.get(bpRecipe).shouldPauseForBreakpoint());

        return satisfiedBPRecipes.length >= 1
            ? onPausedForBreakpointCallback(satisfiedBPRecipes)
            : new HitCountBreakpointWhenConditionWasNotSatisfied(this._debuggeeExecutionControl);
    }

    public statusOfBPRecipe(bpRecipe: HitCountBPRecipe): IBPRecipeStatus {
        const underlyingBPRecipe = this.bpRecipetoData.get(bpRecipe).underlyingBPRecipe;
        const underlyingBPRecipeStatus = this._singleBreakpointSetter.statusOfBPRecipe(underlyingBPRecipe);
        return new HitCountBPRecipeStatus(bpRecipe, underlyingBPRecipeStatus);
    }

    private onUnderlyingBPRecipeStatusChange(statusChanged: BPRecipeStatusChanged): void {
        const bpRecipe = this.underlyingToBPRecipe.get(statusChanged.status.recipe);
        this.bpRecipeStatusChangedListeners.call(new BPRecipeStatusChanged(new HitCountBPRecipeStatus(bpRecipe, statusChanged.status),
            statusChanged.changeSynchronicity));
    }

    private underlyingBPRecipe(bpRecipe: HitCountBPRecipe): BPRecipeInSource<AlwaysPause> {
        return this.bpRecipetoData.get(bpRecipe).underlyingBPRecipe;
    }

    public toString(): string {
        return `HitCountBreakpointsSetter: ${this.bpRecipetoData}`;
    }

    public async install(): Promise<this> {
        await this._singleBreakpointSetter.install();
        return this;
    }
}