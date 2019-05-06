/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/**
 * These file includes functions normally implemented by JavaScript operators. The reason we use these functions
 * is to have better control over the typing of the functions, and use that to help reduce the chance of introducing errors
 * e.g.: We on purpose do not allowe isDefined() to be called for strings, because there is a fair chance that we meant to use isNotEmpty instead
 */

/**
 * Returns whether the object or number is an actual object or number (and is not undefined)
 */
export function isDefined<T extends object | number>(objectOrUndefined: T | undefined): objectOrUndefined is T {
    return objectOrUndefined !== undefined;
}

/**
 * Returns whether the object or number is an actually undefined
 */
export function isUndefined<T extends object | number>(objectOrUndefined: T | undefined): objectOrUndefined is undefined {
    return objectOrUndefined === undefined;
}

/**
 * Returns whether the nullable object or string is not null
 */
export function isNotNull<T extends object | string>(objectOrNull: T | null): objectOrNull is T {
    return objectOrNull !== null;
}

/**
 * Returns whether the nullable object or string is null
 */
export function isNull<T extends object | string>(objectOrNull: T | null): objectOrNull is null {
    return objectOrNull === null;
}

/**
 * Returns whether the string is defined and has at least a letter
 */
export function isNotEmpty(stringOrUndefined: string | undefined): stringOrUndefined is string /* And also has at least one character */ {
    return stringOrUndefined !== undefined
        // Some typings are wrong, so we check for null just in case...
        && <string | null>stringOrUndefined !== null
        && stringOrUndefined.length > 0;
}

/**
 * Returns whether the parameter is an empty string or it's undefined
 */
export function isEmpty(stringOrUndefined: string | undefined): stringOrUndefined is (undefined | '') {
    return stringOrUndefined === undefined || stringOrUndefined.length === 0;
}

/**
 * Returns whether the array has one element or more
 */
export function hasElements(array: unknown[] | undefined): boolean {
    return array !== undefined && array.length > 0;
}

/**
 * Returns whether the regexp operation found any matches, so the parameter is a list of the matches
 */
export function hasMatches<T extends RegExpExecArray | RegExpMatchArray>(matchesOrNull: T | null): matchesOrNull is T {
    return matchesOrNull !== null;
}

/**
 * Returns whether the regexp operation failed to find  any matches, so the parameter is null
 */
export function hasNoMatches(matchesOrNull: RegExpExecArray | RegExpMatchArray | null): matchesOrNull is null {
    return matchesOrNull === null;
}

/**
 * Returns whether the parameter is defined and is true
 */
export function isTrue(booleanOrUndefined: boolean | undefined): boolean {
    return booleanOrUndefined === true;
}

/**
 * Returns whether the parameter is undefined or is false
 */
export function isFalse(booleanOrUndefined: boolean | undefined): boolean {
    return booleanOrUndefined !== true;
}

/**
 * Evaluate an expression (2nd parameter) only if the first parameter is defined. If not, return the third parameter (undefined by default)
 */
export function ifDefinedDo<T extends object | string, R>(somethingOrUndefined: T | undefined, whenDefinedAction: (object: T) => R, resultIfUndefined: R): R;
export function ifDefinedDo<T extends object | string, R>(somethingOrUndefined: T | undefined, whenDefinedAction: (object: T) => R): R | undefined;
export function ifDefinedDo<T extends object | string, R>(somethingOrUndefined: T | undefined, whenDefinedAction: (object: T) => R, resultIfUndefined: R | undefined = undefined): R | undefined {
    return somethingOrUndefined !== undefined
        ? whenDefinedAction(somethingOrUndefined)
        : resultIfUndefined;
}
