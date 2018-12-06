import { IDebugeeLauncher, ITelemetryPropertyCollector } from '../../src';

export class TestDebugeeLauncher implements IDebugeeLauncher {
    public async launch(_telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<void> {
    }

    public async waitForDebugeeToBeReady(): Promise<void> {
    }
}