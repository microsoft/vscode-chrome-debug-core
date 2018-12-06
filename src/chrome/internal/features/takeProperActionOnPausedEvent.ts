import { IComponent } from './feature';
import { PausedEvent } from '../../target/events';
import { IEventsToClientReporter } from '../../client/eventSender';
import { ReasonType } from '../../stoppedEvent';
import { PromiseOrNot } from '../../utils/promises';
import { Vote, VoteCommonLogic, VoteRelevance, ExecuteDecisionBasedOnVotes } from '../../communication/collaborativeDecision';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IDebugeeExecutionControl } from '../../target/controlDebugeeExecution';

export abstract class ResumeCommonLogic extends VoteCommonLogic<void> {
    protected readonly abstract _debugeeExecutionControl: IDebugeeExecutionControl;

    public async execute(): Promise<void> {
        this._debugeeExecutionControl.resume();
    }
}

export abstract class NotifyStoppedCommonLogic extends VoteCommonLogic<void> {
    protected readonly exception: any;
    protected readonly abstract reason: ReasonType;
    protected readonly abstract _eventsToClientReporter: IEventsToClientReporter;

    public async execute(): Promise<void> {
        this._eventsToClientReporter.sendDebugeeIsStopped({ reason: this.reason, exception: this.exception });
    }
}

export type InformationAboutPausedProvider = (paused: PausedEvent) => Promise<Vote<void>>;

export interface EventsConsumedByTakeProperActionOnPausedEvent extends TakeActionBasedOnInformationDependencies {
    onPaused(listener: (paused: PausedEvent) => Promise<void> | void): void;
}

@injectable()
export class TakeProperActionOnPausedEvent implements IComponent {
    public async onPause(paused: PausedEvent): Promise<void> {
        // Ask all the listeners what information they can provide
        const infoPieces = await this._dependencies.askForInformationAboutPause(paused);

        // Remove pieces without any relevant information
        const relevantInfoPieces = infoPieces.filter(response => response.isRelevant());

        await new TakeActionBasedOnInformation(relevantInfoPieces, this._eventsToClientReporter).takeAction();
    }

    public install(): this {
        this._dependencies.onPaused(paused => this.onPause(paused));
        return this;
    }

    constructor(private readonly _dependencies: EventsConsumedByTakeProperActionOnPausedEvent,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter) { }
}

export interface TakeActionBasedOnInformationDependencies {
    askForInformationAboutPause(paused: PausedEvent): PromiseOrNot<Vote<void>[]>;
}

export class TakeActionBasedOnInformation {
    private readonly _takeActionBasedOnVotes: ExecuteDecisionBasedOnVotes<void>;

    public async takeAction(): Promise<void> {
        this.validatePieces();
        return this._takeActionBasedOnVotes.execute();
    }

    public validatePieces(): void {
        // DIEGO TODO: Change this to send telemetry instead
        if (this._takeActionBasedOnVotes.getCountOfVotesWithCertainRelevance(VoteRelevance.OverrideOtherVotes) > 1) {
            throw new Error(`Didn't expect to have multiple override information pieces`);
        }

        if (this._takeActionBasedOnVotes.getCountOfVotesWithCertainRelevance(VoteRelevance.NormalVote) > 1) {
            throw new Error(`Didn't expect to have multiple information pieces`);
        }
    }

    constructor(piecesOfInformation: Vote<void>[],
        private readonly _eventsToClientReporter: IEventsToClientReporter) {
        this._takeActionBasedOnVotes = new ExecuteDecisionBasedOnVotes(async () => {
            // If we don't have any information whatsoever, then we assume that we stopped due to a debugger statement
            return this._eventsToClientReporter.sendDebugeeIsStopped({ reason: 'debugger_statement' });
        }, piecesOfInformation);
    }
}