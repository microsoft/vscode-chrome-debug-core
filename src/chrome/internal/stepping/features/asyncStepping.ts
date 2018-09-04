import { IComponent } from '../../features/feature';
import { PausedEvent } from '../../../target/events';
import {  InformationAboutPausedProvider, ResumeCommonLogic } from '../../features/takeProperActionOnPausedEvent';
import { Crdp } from '../../../..';
import { VoteRelevance, Vote, Abstained } from '../../../communication/collaborativeDecision';
import { injectable } from 'inversify';
import { IDebugeeExecutionControl } from '../../../target/cdtpDebugger';

export interface AsyncSteppingDependencies {
    subscriberForAskForInformationAboutPaused(listener: InformationAboutPausedProvider): void;
    pauseProgramOnAsyncCall(parentStackTraceId: Crdp.Runtime.StackTraceId): Promise<void>;
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
            await this._dependencies.pauseProgramOnAsyncCall(paused.asyncCallStackTraceId);
            return new PausedBecauseAsyncCallWasScheduled(this._debugeeExecutionControl);
        }

        return new Abstained();
    }

    public install(): void {
        this._dependencies.subscriberForAskForInformationAboutPaused(paused => this.askForInformationAboutPaused(paused));
    }

    constructor(private readonly _dependencies: AsyncSteppingDependencies,
        private readonly _debugeeExecutionControl: IDebugeeExecutionControl) { }
}