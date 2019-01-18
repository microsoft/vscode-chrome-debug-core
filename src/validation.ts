/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export function zeroOrPositive(name: string, value: number) {
    if (value < 0) {
        breakWhileDebugging();
        throw new Error(`Expected ${name} to be either zero or a positive number and instead it was ${value}`);
    }
}

/** Used for debugging while developing to automatically break when something unexpected happened */
export function breakWhileDebugging() {
    if (process.env.BREAK_WHILE_DEBUGGING === 'true') {
        // tslint:disable-next-line:no-debugger
        debugger;
    }
}