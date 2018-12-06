import { IDebugeeLauncher, ITelemetryPropertyCollector } from '../../src';

export class TestDebugeeLauncher implements IDebugeeLauncher {
    public launch(_telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<void> {
        throw new Error('Method not implemented.');
    }

    public waitForDebugeeToBeReady(): Promise<void> {
        throw new Error('Method not implemented.');
    }
}