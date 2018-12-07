import { IComponent } from '../../features/feature';
import { PausedEvent } from '../../../target/events';
import { InformationAboutPausedProvider, ResumeCommonLogic } from '../../features/takeProperActionOnPausedEvent';
import { VoteRelevance, Vote, Abstained } from '../../../communication/collaborativeDecision';
import { injectable, inject } from 'inversify';
import { IDebugeeExecutionControl, IDebugeeStepping } from '../../../target/controlDebugeeExecution';
import { TYPES } from '../../../dependencyInjection.ts/types';

export interface EventsConsumedByAsyncStepping {
    subscriberForAskForInformationAboutPaused(listener: InformationAboutPausedProvider): void;
}

export class PausedBecauseAsyncCallWasScheduled extends ResumeCommonLogic {
    public readonly relevance = VoteRelevance.FallbackVote;

    constructor(protected _debugeeExecutionControl: IDebugeeExecutionControl) {
        super();
    }
}

@injectable()
export class AsyncStepping implements IComponent {
    public async askForInformationAboutPaused(paused: PausedEvent): Promise<Vote<void>> {
        if (paused.asyncCallStackTraceId) {
            await this._debugeeStepping.pauseOnAsyncCall({ parentStackTraceId: paused.asyncCallStackTraceId });
            return new PausedBecauseAsyncCallWasScheduled(this._debugeeExecutionControl);
        }

        return new Abstained();
    }

    public install(): void {
        this._dependencies.subscriberForAskForInformationAboutPaused(paused => this.askForInformationAboutPaused(paused));
    }

    constructor(
        @inject(TYPES.EventsConsumedByConnectedCDA) private readonly _dependencies: EventsConsumedByAsyncStepping,
        @inject(TYPES.IDebugeeExecutionControl) private readonly _debugeeExecutionControl: IDebugeeExecutionControl,
        @inject(TYPES.IDebugeeStepping) private readonly _debugeeStepping: IDebugeeStepping) { }
}