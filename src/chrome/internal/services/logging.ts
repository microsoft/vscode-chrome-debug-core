/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Logger, logger } from 'vscode-debugadapter';
import { IExtensibilityPoints } from '../../extensibility/extensibilityPoints';
import { LogLevel } from 'vscode-debugadapter/lib/logger';
import * as _ from 'lodash';

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
        const logFilePath = _.defaultTo(configuration.logFilePath, _.defaultTo(extensibilityPoints.logFilePath, logToFile));
        logger.setup(configuration.logLevel, logFilePath, configuration.shouldLogTimestamps);

        if (configuration.logLevel !== LogLevel.Verbose) {
            /* We want the logger.verbose message to not appear when we configure the logger to only log info level. The logger doesn't support this
            * so we monkey-patch it.
            *
            * Note that any logger.verbose call done before we call logger.setup will get logged anyways
            */
            this.patchLoggerToFilterOutVerboseMessages();
        }
    }

    private patchLoggerToFilterOutVerboseMessages(): void {
        logger.verbose = () => {};
    }
}