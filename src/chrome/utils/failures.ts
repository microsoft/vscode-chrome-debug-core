/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { telemetry } from '../../telemetry';

/**
 * We use these functions to handle recoverable exceptions and rejections (Instead of throwing or rejecting and ending the debugger
 * experience, we just default to returning undefined or another value because the operation isn't critical for the debugging experience)
 */

export function undefinedOnFailure<R>(operation: () => R): R | undefined {
    try {
        return operation();
    } catch (exception) {
        telemetry.reportError('undefinedOnFailure', exception);
        return undefined;
    }
}

export async function asyncUndefinedOnFailure<R>(operation: () => Promise<R>): Promise<R | undefined> {
    try {
        return await operation();
    } catch (exception) {
        telemetry.reportError('asyncUndefinedOnFailure', exception);
        return undefined;
    }
}
