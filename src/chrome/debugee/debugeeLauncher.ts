import { ITelemetryPropertyCollector } from '../../telemetry';

export interface IDebugeeLauncher  {
    launch(telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<void>;
    waitForDebugeeToBeReady(): Promise<void>;
}