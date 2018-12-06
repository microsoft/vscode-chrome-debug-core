import { IComponent } from '../features/feature';
import { AsyncStepping } from './features/asyncStepping';
import { SyncStepping } from './features/syncStepping';
import { ICallFrame } from '../stackTraces/callFrame';
import { IScript } from '../scripts/script';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

@injectable()
export class Stepping implements IComponent {
    public continue(): Promise<void> {
        return this._syncStepping.continue();
    }

    public next(): Promise<void> {
        return this._syncStepping.stepOver();
    }

    public stepIn(): Promise<void> {
        return this._syncStepping.stepInto();
    }

    public stepOut(): Promise<void> {
        return this._syncStepping.stepOut();
    }

    public pause(): Promise<void> {
        return this._syncStepping.pause();
    }

    public restartFrame(callFrame: ICallFrame<IScript>): Promise<void> {
        return this._syncStepping.restartFrame(callFrame);
    }

    public install(): this {
        this._asyncStepping.install();
        return this;
    }

    constructor(
        @inject(TYPES.SyncStepping) private readonly _syncStepping: SyncStepping,
        @inject(TYPES.AsyncStepping) private readonly _asyncStepping: AsyncStepping
    ) { }
}