/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/**
 * We use these functions to handle recoverable exceptions and rejections (Instead of throwing or rejecting and ending the debugger
 * experience, we just default to returning undefined or another value because the operation isn't critical for the debugging experience)
 */

export function undefinedOnFailure<R>(operation: () => R): R | undefined {
    try {
        return operation();
    } catch (exception) {
        // TODO DIEGO: Report telemetry for this
        return undefined;
    }
}

export async function asyncUndefinedOnFailure<R>(operation: () => Promise<R>): Promise<R | undefined> {
    try {
        return await operation();
    } catch (exception) {
        // TODO DIEGO: Report telemetry for this
        return undefined;
    }
}
