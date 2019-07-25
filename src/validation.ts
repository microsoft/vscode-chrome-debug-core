/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

export function zeroOrPositive(name: string, value: number) {
    if (value < 0) {
        throwError(new Error(localize('error.zeroOrPositive.invalid', `Expected {0} to be either zero or a positive number and instead it was {1}`, name, value)));
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
        throwError(new Error(localize('error.notNullNorUndefinedElements.invalid', `Expected {0} to not have any null or undefined elements, yet the element at #{1} was {1}`, name, index, `${array[index]}`)));
    }
}

export function notNullOrUndefined(name: string, value: unknown): void {
    if (value === null || value === undefined) {
        throwError(new Error(localize('error.notNullOrUndefined.invalid', `Expected {0} to not be neither null nor undefined yet it was: {1}`, name, value)));
    }
}

export function notEmpty(name: string, elements: unknown[]): void {
    if (elements.length < 1) {
        throwError(new Error(localize('error.notEmpty.invalid', `Expected {0} to not be empty: {1}`, name, elements.toString())));
    }
}

export function throwError(error: Error): never {
    breakWhileDebugging();
    throw error;
}
