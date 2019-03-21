/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ITelemetryPropertyCollector } from '../../telemetry';
import { ILaunchRequestArgs } from '../../debugAdapterInterfaces';

export interface ILaunchResult {
    address?: string;
    port?: number;
    url?: string;
}

export interface IDebuggeeLauncher {
    launch(args: ILaunchRequestArgs, telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<ILaunchResult>;
    stop(): Promise<void>;
}

export interface IDebuggeeRunner {
    run(telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<void>;
    stop(): Promise<void>;
}