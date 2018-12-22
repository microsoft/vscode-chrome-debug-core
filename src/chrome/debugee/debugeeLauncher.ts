import { ITelemetryPropertyCollector } from '../../telemetry';
import { ILaunchRequestArgs } from '../../debugAdapterInterfaces';

export interface ILaunchResult {
    address?: string;
    port?: number;
    url?: string;
}

export interface IDebuggeeLauncher  {
    launch(args: ILaunchRequestArgs, telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<ILaunchResult>;
    waitForDebugeeToBeReady(): Promise<void>;
}