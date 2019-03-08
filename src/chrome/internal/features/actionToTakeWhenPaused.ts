import { IDebugeeExecutionController } from '../../cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { ReasonType } from '../../stoppedEvent';
import { IEventsToClientReporter } from '../../client/eventsToClientReporter';
import { PausedEvent } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';

/**
 * Action that a component proposes to do when the debuggee is paused. Should be show the pause to the client? Auto-resume?
 */
const ImplementsActionToTakeWhenPaused = Symbol();
export interface IActionToTakeWhenPaused {
    [ImplementsActionToTakeWhenPaused]: string;

    execute(actionsWithLowerPriority: IActionToTakeWhenPaused[]): Promise<void>;
}

export abstract class BaseActionToTakeWhenPaused implements IActionToTakeWhenPaused {
    [ImplementsActionToTakeWhenPaused] = 'ActionToTakeWhenPaused';

    public abstract execute(actionsWithLowerPriority: IActionToTakeWhenPaused[]): Promise<void>;
}

/**
 * Action used when the component doesn't have any useful information about the Paused event that just happened
 */
export class NoActionIsNeededForThisPause extends BaseActionToTakeWhenPaused {
    constructor(public readonly actionProvider: unknown /* Used for debugging purposes only */) {
        super();
    }

    public async execute(): Promise<void> {
        // We don't need to do anything
    }

    public toString(): string {
        return `${this.actionProvider} doesn't need to do any action for this pause`;
    }
}

/**
 * Base action to be used when a component is going to suggest auto-resume the pause
 */
export abstract class BasePauseShouldBeAutoResumed extends BaseActionToTakeWhenPaused {
    protected readonly abstract _debugeeExecutionControl: IDebugeeExecutionController;

    public async execute(): Promise<void> {
        this._debugeeExecutionControl.resume();
    }
}

/**
 * Base action to be used when a component is going to suggest showing the pause to the client
 */
export abstract class BaseNotifyClientOfPause extends BaseActionToTakeWhenPaused {
    protected readonly exception: any;
    protected readonly abstract reason: ReasonType;
    protected readonly abstract _eventsToClientReporter: IEventsToClientReporter;

    public async execute(): Promise<void> {
        this._eventsToClientReporter.sendDebugeeIsStopped({ reason: this.reason, exception: this.exception });
    }
}

/**
 * Action used when we hit a debugger; statement in the code
 */
export class HitDebuggerStatement extends BaseNotifyClientOfPause {
    protected readonly reason = 'debugger_statement';

    constructor(
        protected readonly _eventsToClientReporter: IEventsToClientReporter,
    ) {
        super();
    }
}

export type ActionToTakeWhenPausedProvider = (paused: PausedEvent) => Promise<IActionToTakeWhenPaused>;
