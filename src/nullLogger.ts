/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILogger, ILoggingConfiguration } from './chrome/internal/services/logging';
import { Logger } from 'vscode-debugadapter';
import { IExtensibilityPoints } from './chrome/extensibility/extensibilityPoints';

/**
 * Implements ILogger as a no-op
 */
export class NullLogger implements ILogger {
    log(_msg: string, _level?: Logger.LogLevel): void {
        // no-op
    }

    verbose(_msg: string): void {
        // no-op
    }

    warn(_msg: string): void {
        // no-op
    }

    error(_msg: string): void {
        // no-op
    }

    install(_extensibilityPoints: IExtensibilityPoints, _configuration: ILoggingConfiguration): this {
        return this;
    }
}