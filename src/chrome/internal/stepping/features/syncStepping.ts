/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { ScriptCallFrame, CallFrameWithState } from '../../stackTraces/callFrame';
import { IActionToTakeWhenPaused, NoActionIsNeededForThisPause, BaseNotifyClientOfPause } from '../../features/actionToTakeWhenPaused';
import { injectable, inject } from 'inversify';
import { IDebuggeeExecutionController } from '../../../cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PausedEvent } from '../../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { IDebuggeeSteppingController } from '../../../cdtpDebuggee/features/cdtpDebugeeSteppingController';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';
import { printClassDescription, printInstanceDescription } from '../../../utils/printing';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { logger } from 'vscode-debugadapter';
import { DoNotLog } from '../../../logging/decorators';
import { LocalizedError } from '../../../utils/localizedError';

type SteppingAction = () => Promise<void>;

interface SyncSteppingStatus {
    startStepping(): void;

    onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused>;
}

@printClassDescription
export class FinishedStepping extends BaseNotifyClientOfPause {
    protected readonly reason = 'step';

    public constructor(
        private readonly _changeStatus: (newStatus: SyncSteppingStatus) => void,
        protected readonly _eventsToClientReporter: IEventsToClientReporter,
    ) {
        super();
    }

    public async execute(): Promise<void> {
        this._changeStatus(new CurrentlyIdle(this._changeStatus, this._eventsToClientReporter));
        await super.execute();
    }

    public toString(): string {
        return 'Finished stepping';
    }
}

@printClassDescription
export class UserPaused extends BaseNotifyClientOfPause {
    protected readonly reason = 'pause';
    public readonly toString = printInstanceDescription;

    public constructor(
        private readonly _changeStatus: (newStatus: SyncSteppingStatus) => void,
        protected readonly _eventsToClientReporter: IEventsToClientReporter,
    ) {
        super();
    }

    public async execute(): Promise<void> {
        this._changeStatus(new CurrentlyIdle(this._changeStatus, this._eventsToClientReporter));
        await super.execute();
    }
}

@printClassDescription
class CurrentlyStepping implements SyncSteppingStatus {
    public readonly toString = printInstanceDescription;

    public constructor(
        private readonly _changeStatus: (newStatus: SyncSteppingStatus) => void,
        private readonly _eventsToClientReporter: IEventsToClientReporter) { }

    public startStepping(): SyncSteppingStatus {
        throw new LocalizedError('error.stepping.alreadyStepping', localize('error.stepping.alreadyStepping', 'Cannot start stepping again while the program is already stepping'));
    }

    public async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        // At the moment, after we pause, if the reason is not because stepping finished then we don't know
        // what the new state should be:
        //   - We could be hitting a breakpoint, and then we'd be idle
        //   - We could be triggering smart step, so we could potentially still be stepping.
        // We change to the unknown state so we'll allow the user to step again if he wants to
        // (If the FinishedStepping is choosen to resolve the pause, the state will be changed to Idle)
        //
        // TODO: The stepping state needs more work. Figure out what is the right thing to do here, and what to do about the stepping states
        this._changeStatus(new UnknownState(this._changeStatus, this._eventsToClientReporter));

        if (paused.reason === 'other') {
            return new FinishedStepping(this._changeStatus, this._eventsToClientReporter);
        } else {
            return new NoActionIsNeededForThisPause(this);
        }
    }
}

@printClassDescription
class CurrentlyPausing implements SyncSteppingStatus {
    public readonly toString = printInstanceDescription;

    public constructor(
        private readonly _changeStatus: (newStatus: SyncSteppingStatus) => void,
        private readonly _eventsToClientReporter: IEventsToClientReporter) { }

    public startStepping(): SyncSteppingStatus {
        throw new LocalizedError('error.stepping.currentlyPausing', localize('error.stepping.currentlyPausing', 'Cannot start stepping while the debugger is trying to pause the program'));
    }

    public async onProvideActionForWhenPaused(_paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        return new UserPaused(this._changeStatus, this._eventsToClientReporter);
    }
}

@printClassDescription
class CurrentlyIdle implements SyncSteppingStatus {
    public readonly toString = printInstanceDescription;

    public constructor(
        private readonly _changeStatus: (newStatus: SyncSteppingStatus) => void,
        private readonly _eventsToClientReporter: IEventsToClientReporter) { }

    public startStepping(): void {
        this._changeStatus(new CurrentlyStepping(this._changeStatus, this._eventsToClientReporter));
    }

    public async onProvideActionForWhenPaused(_paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        return new NoActionIsNeededForThisPause(this);
    }
}

@printClassDescription
class UnknownState extends CurrentlyIdle { }

/**
 * This class provides functionality to step thorugh the debuggee's code
 */
@injectable()
@printClassDescription
export class SyncStepping {
    private _status: SyncSteppingStatus = new CurrentlyIdle(s => this.changeStatus(s), this._eventsToClientReporter);

    public stepOver = this.createSteppingMethod(() => this._debugeeStepping.stepOver());
    public stepInto = this.createSteppingMethod(() => this._debugeeStepping.stepInto({ breakOnAsyncCall: true }));
    public stepOut = this.createSteppingMethod(() => this._debugeeStepping.stepOut());

    constructor(
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter,
        @inject(TYPES.IDebuggeeSteppingController) private readonly _debugeeStepping: IDebuggeeSteppingController,
        @inject(TYPES.IDebuggeePausedHandler) private readonly _debuggeePausedHandler: IDebuggeePausedHandler,
        @inject(TYPES.IDebuggeeExecutionController) private readonly _debugeeExecutionControl: IDebuggeeExecutionController) {
        this._debuggeePausedHandler.registerActionProvider(paused => this.onProvideActionForWhenPaused(paused));
    }

    private changeStatus(newStatus: SyncSteppingStatus): void {
        logger.log(`Changing sync-stepping state from: ${this._status} to ${newStatus}`);
        this._status = newStatus;
    }

    public continue(): Promise<void> {
        return this._debugeeExecutionControl.resume();
    }

    public pause(): Promise<void> {
        this.changeStatus(new CurrentlyPausing(s => this.changeStatus(s), this._eventsToClientReporter));
        return this._debugeeExecutionControl.pause();
    }

    @DoNotLog()
    private async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        const result = await this._status.onProvideActionForWhenPaused(paused);
        logger.log(`${this}.onProvideActionForWhenPaused() returns ${result}`);
        return result;
    }

    public async restartFrame(callFrame: ScriptCallFrame<CallFrameWithState>): Promise<void> {
        this._status.startStepping();
        await this._debugeeStepping.restartFrame(callFrame);
        await this._debugeeStepping.stepInto({ breakOnAsyncCall: true });
    }

    private createSteppingMethod(steppingAction: SteppingAction): (() => Promise<void>) {
        return async () => {
            this._status.startStepping();
            await steppingAction();
        };
    }
}