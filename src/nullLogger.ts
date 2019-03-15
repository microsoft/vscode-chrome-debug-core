/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Logger } from 'vscode-debugadapter';

/**
 * Implements ILogger as a no-op
 */
export class NullLogger implements Logger.ILogger {
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

}