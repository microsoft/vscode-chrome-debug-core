/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { InternalError } from './chrome/utils/internalError';

export function zeroOrPositive(name: string, value: number) {
    if (value < 0) {
        throwError(new InternalError('error.zeroOrPositive.invalid', `Expected ${name} to be either zero or a positive number and instead it was ${value}`));
    }
}

/** Used for debugging while developing to automatically break when something unexpected happened */
export function breakWhileDebugging() {
    if (process.env.BREAK_WHILE_DEBUGGING === 'true') {
        // tslint:disable-next-line:no-debugger
        debugger;
    }
}

export function notNullNorUndefinedElements(name: string, array: unknown[]): void {
    const index = array.findIndex(element => element === null || element === undefined);
    if (index >= 0) {
        throwError(new InternalError('error.notNullNorUndefinedElements.invalid', `Expected ${name} to not have any null or undefined elements, yet the element at #${index} was ${array[index]}`));
    }
}

export function notNullOrUndefined(name: string, value: unknown): void {
    if (value === null || value === undefined) {
        throwError(new InternalError('error.notNullOrUndefined.invalid', `Expected ${name} to not be neither null nor undefined yet it was: ${value}`));
    }
}

export function notEmpty(name: string, elements: unknown[]): void {
    if (elements.length < 1) {
        throwError(new InternalError('error.notEmpty.invalid', `Expected ${name} to not be empty: ${elements}`));
    }
}

export function throwError(error: Error): never {
    breakWhileDebugging();
    throw error;
}
