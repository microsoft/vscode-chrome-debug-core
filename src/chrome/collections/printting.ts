/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/** Methods to print the contents of a collection for logging and debugging purposes (This is not intended for the end-user to see) */
export function printMap<K, V>(typeDescription: string, map: { entries(): IterableIterator<[K, V]> }): string {
    const elementsPrintted = Array.from(map.entries()).map(entry => `${entry[0]}: ${entry[1]}`).join('; ');
    return `${typeDescription} { ${elementsPrintted} }`;
}

export function printSet<T>(typeDescription: string, set: Set<T>): string {
    const elementsPrintted = printElements(Array.from(set), '; ');
    return `${typeDescription} { ${elementsPrintted} }`;
}

export function printArray<T>(typeDescription: string, elements: T[]): string {
    const elementsPrintted = printElements(elements, ', ');
    return typeDescription ? `${typeDescription} [ ${elementsPrintted} ]` : `[ ${elementsPrintted} ]`;
}

export function printIterable<T>(typeDescription: string, iterable: IterableIterator<T>): string {
    const elementsPrintted = printElements(Array.from(iterable), '; ');
    return `${typeDescription} { ${elementsPrintted} }`;
}

function printElements<T>(elements: T[], separator = '; '): string {
    return elements.map(element => `${element}`).join(separator);
}