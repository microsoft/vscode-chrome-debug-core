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
        logger.setup(LogLevel.Warn /* This controls the console logging not the file logging */,
            logFilePath, configuration.shouldLogTimestamps);

        if (configuration.logLevel !== LogLevel.Verbose) {
            /* We want the logger.verbose message to not appear when we configure the logger to only log info level. The logger doesn't support this
            * so we monkey-patch it.
            *
            * Note that any logger.verbose call done before we call logger.setup will get logged anyways
            */
            this.patchLoggerToFilterOutVerboseMessages(configuration.logLevel);
        }
    }

    private patchLoggerToFilterOutVerboseMessages(logLevel: LogLevel): void {
        const originalLoggerVerbose = logger.verbose;
        logger.verbose = function (msg: string) {
            /* vscode-debugadapter logs the vscode protocol messages to/from the client as verbose. We want to consider it info in this extension.
             * We override logger.verbose to drop everything else, but keep these messages when we are logging on level 'info'/'log'
             */
            // See https://github.com/microsoft/vscode-debugadapter-node/blob/768e505c7d362f733a29c89fa973c6285ce8fb27/adapter/src/loggingDebugSession.ts#L50
            if (logLevel === LogLevel.Log && msg.startsWith('To client:') || msg.startsWith('From client:')) {
                originalLoggerVerbose.call(this, msg);
            }
        };
    }
}