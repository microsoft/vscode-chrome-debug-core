/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ScriptCallFrame, CallFrameWithState } from '../../stackTraces/callFrame';
import { IActionToTakeWhenPaused, NoActionIsNeededForThisPause, BaseNotifyClientOfPause } from '../../features/actionToTakeWhenPaused';
import { injectable, inject } from 'inversify';
import { IDebuggeeExecutionController } from '../../../cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PausedEvent } from '../../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { IDebuggeeSteppingController } from '../../../cdtpDebuggee/features/cdtpDebugeeSteppingController';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';
import { printClassDescription } from '../../../utils/printing';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';

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
}

class CurrentlyStepping implements SyncSteppingStatus {
    public constructor(
        private readonly _changeStatus: (newStatus: SyncSteppingStatus) => void,
        private readonly _eventsToClientReporter: IEventsToClientReporter) { }

    public startStepping(): SyncSteppingStatus {
        throw new Error('Cannot start stepping again while the program is already stepping');
    }

    public async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        if (paused.reason === 'other') {
            return new FinishedStepping(this._changeStatus, this._eventsToClientReporter);
        } else {
            return new NoActionIsNeededForThisPause(this);
        }
    }
}

class CurrentlyIdle implements SyncSteppingStatus {
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

/**
 * This class provides functionality to step thorugh the debuggee's code
 */
@injectable()
export class SyncStepping {
    private _status: SyncSteppingStatus = new CurrentlyIdle(this.changeStatus(), this._eventsToClientReporter);

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

    private changeStatus(): (newStatus: SyncSteppingStatus) => void {
        return (newStatus: SyncSteppingStatus) => this._status = newStatus;
    }

    public continue(): Promise<void> {
        return this._debugeeExecutionControl.resume();
    }

    public pause(): Promise<void> {
        return this._debugeeExecutionControl.pause();
    }

    private async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        return this._status.onProvideActionForWhenPaused(paused);
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