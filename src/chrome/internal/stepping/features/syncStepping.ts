import { ICallFrame } from '../../stackTraces/callFrame';

import { IScript } from '../../scripts/script';
import { InformationAboutPausedProvider, } from '../../features/takeProperActionOnPausedEvent';
import { IComponent } from '../../features/feature';
import { PausedEvent } from '../../../target/events';
import { Abstained, Vote } from '../../../communication/collaborativeDecision';
import { injectable, inject } from 'inversify';
import { CDTPDebugger } from '../../../target/cdtpDebugger';
import { IDebugeeStepping, IDebugeeExecutionControl } from '../../../target/controlDebugeeExecution';

type SteppingAction = () => Promise<void>;

interface SyncSteppingStatus {
    startStepping(): SyncSteppingStatus;
}

class CurrentlyStepping implements SyncSteppingStatus {
    public startStepping(): SyncSteppingStatus {
        throw new Error('Cannot start stepping again while the program is already stepping');
    }

}

class CurrentlyIdle implements SyncSteppingStatus {
    public startStepping(): SyncSteppingStatus {
        return new CurrentlyStepping();
    }
}

export interface SyncSteppingDependencies {
    subscriberForAskForInformationAboutPaused(listener: InformationAboutPausedProvider): void;
}

@injectable()
export class SyncStepping implements IComponent {
    private _status: SyncSteppingStatus = new CurrentlyIdle();

    public stepOver = this.createSteppingMethod(() => this._debugeeStepping.stepOver());
    public stepInto = this.createSteppingMethod(() => this._debugeeStepping.stepInto({ breakOnAsyncCall: true }));
    public stepOut = this.createSteppingMethod(() => this._debugeeStepping.stepOut());

    public continue(): Promise<void> {
        return this._debugeeExecutionControl.resume();
    }

    public pause(): Promise<void> {
        return this._debugeeExecutionControl.pause();
    }

    private async askForInformationAboutPaused(_paused: PausedEvent): Promise<Vote<void>> {
        return new Abstained();
    }

    public async restartFrame(callFrame: ICallFrame<IScript>): Promise<void> {
        this._status = this._status.startStepping();
        await this._debugeeStepping.restartFrame(callFrame);
        await this._debugeeStepping.stepInto({ breakOnAsyncCall: true });
    }

    private createSteppingMethod(steppingAction: SteppingAction): (() => Promise<void>) {
        return async () => {
            this._status = this._status.startStepping();
            await steppingAction();
            this._status = new CurrentlyIdle();
        };
    }

    public install(): void {
        this._dependencies.subscriberForAskForInformationAboutPaused(paused => this.askForInformationAboutPaused(paused));
    }

    constructor(private readonly _dependencies: SyncSteppingDependencies,
        @inject(CDTPDebugger) private readonly _debugeeStepping: IDebugeeStepping,
        @inject(CDTPDebugger) private readonly _debugeeExecutionControl: IDebugeeExecutionControl) { }
}