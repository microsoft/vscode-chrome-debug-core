/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Logger, logger } from 'vscode-debugadapter';
import { IExtensibilityPoints } from '../../extensibility/extensibilityPoints';
import { isNotEmpty } from '../../utils/typedOperators';
import { LogLevel } from 'vscode-debugadapter/lib/logger';

export interface ILoggingConfiguration {
    logLevel: Logger.LogLevel;
    shouldLogTimestamps: boolean;
    logFilePath?: string;
}

export interface ILogger {
    verbose(entry: string): void;
    log(entry: string): void;
    install(extensibilityPoints: IExtensibilityPoints, configuration: ILoggingConfiguration): this;
}

export class Logging implements ILogger {
    public verbose(entry: string): void {
        logger.verbose(entry);
    }

    public log(entry: string): void {
        logger.log(entry);
    }

    public install(extensibilityPoints: IExtensibilityPoints, configuration: ILoggingConfiguration): this {
        this.configure(extensibilityPoints, configuration);
        return this;
    }

    public configure(extensibilityPoints: IExtensibilityPoints, configuration: ILoggingConfiguration): void {
        const logToFile = configuration.logLevel !== LogLevel.Stop;

        // The debug configuration provider should have set logFilePath on the launch config. If not, default to 'true' to use the
        // "legacy" log file path from the CDA subclass
        const logFilePath = isNotEmpty(configuration.logFilePath) || isNotEmpty(extensibilityPoints.logFilePath) || logToFile;
        logger.setup(configuration.logLevel, logFilePath, configuration.shouldLogTimestamps);
    }
}