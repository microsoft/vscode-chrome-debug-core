/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IActionToTakeWhenPaused, NoActionIsNeededForThisPause, BasePauseShouldBeAutoResumed } from '../../features/actionToTakeWhenPaused';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { PausedEvent } from '../../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { IDebuggeeExecutionController } from '../../../cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { IDebuggeeSteppingController } from '../../../cdtpDebuggee/features/cdtpDebugeeSteppingController';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';
import { printClassDescription } from '../../../utils/printing';
import { isDefined } from '../../../utils/typedOperators';
import { DoNotLog } from '../../../logging/decorators';

@printClassDescription
export class PausedBecauseAsyncCallWasScheduled extends BasePauseShouldBeAutoResumed {
    constructor(protected _debuggeeExecutionControl: IDebuggeeExecutionController) {
        super();
    }
}

@injectable()
export class AsyncStepping {
    constructor(
        @inject(TYPES.IDebuggeePausedHandler) private readonly _debuggeePausedHandler: IDebuggeePausedHandler,
        @inject(TYPES.IDebuggeeExecutionController) private readonly _debugeeExecutionControl: IDebuggeeExecutionController,
        @inject(TYPES.IDebuggeeSteppingController) private readonly _debugeeStepping: IDebuggeeSteppingController) {
        this._debuggeePausedHandler.registerActionProvider(paused => this.onProvideActionForWhenPaused(paused));
    }

    @DoNotLog()
    public async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        if (isDefined(paused.asyncCallStackTraceId)) {
            await this._debugeeStepping.pauseOnAsyncCall({ parentStackTraceId: paused.asyncCallStackTraceId });
            return new PausedBecauseAsyncCallWasScheduled(this._debugeeExecutionControl);
        }

        return new NoActionIsNeededForThisPause(this);
    }

    public toString(): string {
        return 'AsyncStepping';
    }
}