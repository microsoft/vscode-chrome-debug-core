/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { ValidatedMultiMap } from './validatedMultiMap';

export function groupByKey<T, K>(elements: T[], obtainKey: (element: T) => K): ValidatedMultiMap<K, T> {
    const groupped = ValidatedMultiMap.empty<K, T>();
    elements.forEach(element => groupped.add(obtainKey(element), element));
    return groupped;
}

export function determineOrderingOfStrings(left: string, right: string): number {
    if (left < right) {
        return -1;
    } else if (left > right) {
        return 1;
    } else {
        return 0;
    }
}

export function singleElementOfArray<T>(array: ReadonlyArray<T>): T {
    if (array.length === 1) {
        return array[0];
    } else {
        throw new Error(localize('error.singleElementOfArray.invalid', 'Expected array {0} to have exactly a single element yet it had {1}', array.toString(), array.length));
    }
}