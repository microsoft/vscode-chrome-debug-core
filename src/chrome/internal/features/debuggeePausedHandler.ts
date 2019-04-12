/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { PausedEvent } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { IEventsToClientReporter } from '../../client/eventsToClientReporter';
import { PromiseOrNot } from '../../utils/promises';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ICDTPDebuggeeExecutionEventsProvider } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { findBiggestItem } from '../../collections/findBiggestItem';
import { Logging } from '../services/logging';
import { printArray } from '../../collections/printing';
import { IActionToTakeWhenPaused, HitDebuggerStatement, NoActionIsNeededForThisPause } from './actionToTakeWhenPaused';
import { actionClassToPriorityIndexMapping, ActionToTakeWhenPausedClass } from './pauseActionsPriorities';
import { asyncMap } from '../../collections/async';

type ActionToTakeWhenPausedProvider = (paused: PausedEvent) => PromiseOrNot<IActionToTakeWhenPaused>;

export interface IDebuggeePausedHandler {
    registerActionProvider(provider: (paused: PausedEvent) => PromiseOrNot<IActionToTakeWhenPaused>): void;
    reprocessLatestPause(): Promise<void>; // TODO: Try to figure out a nicer way to do this without reprocessing the pause event
}

/**
 * Class responsible for determining what to do when the debuggee hits a pause.
 * This class will query all the individual components that may have some information about why we paused. It'll gather
 * all the information/actions from those components, find out which piece of information/action has the highest priority,
 * and use that action/information to take the decision.
 */
@injectable()
export class DebuggeePausedHandler implements IDebuggeePausedHandler {
    private readonly _actionToTakeWhenPausedProviders: ActionToTakeWhenPausedProvider[] = [];

    private latestPaused: PausedEvent | null = null;
    private isClientPaused = false;

    constructor(
        @inject(TYPES.ICDTPDebuggeeExecutionEventsProvider) private readonly _cdtpDebuggerEventsProvider: ICDTPDebuggeeExecutionEventsProvider,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter,
        @inject(TYPES.ILogger) private readonly _logging: Logging) {
        this._cdtpDebuggerEventsProvider.onPaused(paused => this.onPause(paused));
        this._cdtpDebuggerEventsProvider.onResumed(() => this.onResumed());
    }

    public registerActionProvider(provider: ActionToTakeWhenPausedProvider): void {
        this._actionToTakeWhenPausedProviders.push(provider);
    }

    public async onPause(paused: PausedEvent): Promise<void> {
        // Find all the actions that we need to take when paused (Most components shouldn't care and should normally return NoActionIsNeededForThisPause)
        const actionsToTake = await asyncMap(this._actionToTakeWhenPausedProviders, provider => provider(paused));
        const relevantActionsToTake = actionsToTake.filter(action => !(action instanceof NoActionIsNeededForThisPause)); // We remove actions that don't need to do anything

        const highestPriorityAction = await findBiggestItem<IActionToTakeWhenPaused>(relevantActionsToTake,
            () => new HitDebuggerStatement(this._eventsToClientReporter), // If we don't have any information whatsoever, then we assume that we stopped due to a debugger statement
            voteClass => actionClassToPriorityIndexMapping.get(<ActionToTakeWhenPausedClass>voteClass.constructor)); // Sort them by priority

        this.logActionToTake(actionsToTake, highestPriorityAction);

        // Execute the action with the highest priority
        this.isClientPaused = !highestPriorityAction.isAutoResuming();
        await highestPriorityAction.execute(actionsToTake);
    }

    public async onResumed(): Promise<void> {
        if (this.isClientPaused) {
            await this._eventsToClientReporter.sendDebuggeeIsResumed();
            this.isClientPaused = false;
        }
    }

    public logActionToTake(allActionsToTake: IActionToTakeWhenPaused[], highestPriorityActionToTake: IActionToTakeWhenPaused): void {
        const nonExecutedRelevantActions = allActionsToTake.filter(action => !(action === highestPriorityActionToTake));

        // TODO: Report telemetry here
        this._logging.verbose(printArray(`Paused - choosen: ${highestPriorityActionToTake} other actions = `, nonExecutedRelevantActions));
    }

    public async reprocessLatestPause(): Promise<void> {
        if (this.latestPaused !== null) {
            await this.onPause(this.latestPaused);
        }
    }
}
