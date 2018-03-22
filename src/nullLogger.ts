/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Logger } from 'vscode-debugadapter';

/**
 * Implements ILogger as a no-op
 */
export class NullLogger implements Logger.ILogger {
    log(msg: string, level?: Logger.LogLevel): void {
        // no-op
    }

    verbose(msg: string): void {
        // no-op
    }

    warn(msg: string): void {
        // no-op
    }

    error(msg: string): void {
        // no-op
    }

}