/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IBPRecipe } from '../bpRecipe';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { PauseOnHitCount } from '../bpActionWhenHit';
import { ValidatedMap } from '../../../collections/validatedMap';
import { HitCountConditionParser, HitCountConditionFunction } from './hitCountConditionParser';
import { BaseNotifyClientOfPause, ActionToTakeWhenPausedProvider, IActionToTakeWhenPaused, NoActionIsNeededForThisPause } from '../../features/actionToTakeWhenPaused';
import { ReasonType } from '../../../stoppedEvent';
import { injectable, inject } from 'inversify';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PausedEvent } from '../../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { ScriptOrSourceOrURLOrURLRegexp } from '../../locations/location';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';

export interface IHitCountBreakpointsDependencies {
    registerAddBPRecipeHandler(handlerRequirements: (bpRecipe: BPRecipeInSource) => boolean,
        handler: (bpRecipe: BPRecipeInSource) => Promise<void>): void;

    addBPRecipe(bpRecipe: BPRecipeInSource): Promise<void>;
    notifyBPWasHit(bpRecipe: BPRecipeInSource): Promise<void>;

    registerActionToTakeWhenPausedProvider(listener: ActionToTakeWhenPausedProvider): void;
    publishGoingToPauseClient(): void;
}

class NotAbstained { }

class HitCountBPData {
    private _hitCount = 0;

    constructor(
        private readonly _voter: unknown,
        public readonly hitBPRecipe: BPRecipeInSource<PauseOnHitCount>,
        private readonly _shouldPauseCondition: HitCountConditionFunction) { }

    public notifyBPHit(): object {
        return this._shouldPauseCondition(this._hitCount++)
            ? new NotAbstained()
            : new NoActionIsNeededForThisPause(this._voter);
    }
}

export class HitAndSatisfiedCountBPCondition extends BaseNotifyClientOfPause {
    protected reason: ReasonType = 'breakpoint';

    constructor(protected readonly _eventsToClientReporter: IEventsToClientReporter) {
        super();
    }
}

// TODO DIEGO: Install and use this feature
/**
 * Implement the hit count breakpoints feature
 */
@injectable()
export class HitCountBreakpoints {
    private readonly underlyingToBPRecipe = new ValidatedMap<IBPRecipe<ScriptOrSourceOrURLOrURLRegexp>, HitCountBPData>();

    constructor(
        private readonly _dependencies: IHitCountBreakpointsDependencies,
        @inject(TYPES.IDebuggeePausedHandler) private readonly _debuggeePausedHandler: IDebuggeePausedHandler,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter) {
        this._dependencies.registerAddBPRecipeHandler(
            bpRecipe => bpRecipe.bpActionWhenHit instanceof PauseOnHitCount,
            bpRecipe => this.addBPRecipe(bpRecipe as BPRecipeInSource<PauseOnHitCount>));
        this._debuggeePausedHandler.registerActionProvider(paused => this.onProvideActionForWhenPaused(paused));
    }

    private async addBPRecipe(bpRecipe: BPRecipeInSource<PauseOnHitCount>): Promise<void> {
        const underlyingBPRecipe = bpRecipe.withAlwaysBreakAction();
        const shouldPauseCondition = new HitCountConditionParser(bpRecipe.bpActionWhenHit.pauseOnHitCondition).parse();
        this._dependencies.addBPRecipe(underlyingBPRecipe);
        this.underlyingToBPRecipe.set(underlyingBPRecipe, new HitCountBPData(this, bpRecipe, shouldPauseCondition));
    }

    public async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        const hitCountBPData = paused.hitBreakpoints.map(hitBPRecipe =>
            this.underlyingToBPRecipe.tryGetting(hitBPRecipe.unmappedBPRecipe)).filter(bpRecipe => bpRecipe !== undefined);

        const individualDecisions = hitCountBPData.map(data => data.notifyBPHit());
        return individualDecisions.some(v => !(v instanceof NoActionIsNeededForThisPause))
            ? new HitAndSatisfiedCountBPCondition(this._eventsToClientReporter)
            : new NoActionIsNeededForThisPause(this);
    }
}