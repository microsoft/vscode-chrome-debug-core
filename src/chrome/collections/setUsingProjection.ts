/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ValidatedMap, IValidatedMap } from './validatedMap';
import { printSet } from './printing';

export interface IProjection<K, P> {
    (element: K): P;
}

/** A set which uses a projection of the key to compare it's elements (This is equivalent to define a custom comparison criteria in other languages) */
export class SetUsingProjection<T, P> implements Set<T> {
    private readonly _projectionToElement: IValidatedMap<P, T>;

    constructor(private readonly _projection: IProjection<T, P>, readonly initialContents: T[] = []) {
        const entries = initialContents.map<[P, T]>(element => {
            const projected = this._projection(element);
            return [projected, element];
        });
        this._projectionToElement = new ValidatedMap<P, T>(entries);
    }

    public clear(): void {
        this._projectionToElement.clear();
    }

    public delete(element: T): boolean {
        const projectedValue = this._projection(element);
        return this._projectionToElement.delete(projectedValue);
    }

    public forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void {
        this._projectionToElement.forEach(element => {
            callbackfn.call(thisArg, element, element, this);
        }, thisArg);
    }

    public tryGetting(referenceElement: T): T | undefined {
        const projectedValue = this._projection(referenceElement);
        const elementInSet = this._projectionToElement.tryGetting(projectedValue);
        return elementInSet !== undefined ? elementInSet : undefined;
    }

    public get(element: T): T {
        const projectedValue = this._projection(element);
        return this._projectionToElement.get(projectedValue);
    }

    public has(element: T): boolean {
        return this.tryGetting(element) !== undefined;
    }

    public add(element: T): this {
        this._projectionToElement.set(this._projection(element), element);
        return this;
    }

    public addAndReplaceIfExists(element: T): this {
        this._projectionToElement.setAndReplaceIfExists(this._projection(element), element);
        return this;
    }

    public get size(): number {
        return this._projectionToElement.size;
    }

    public * keys(): IterableIterator<T> {
        for (const element of this._projectionToElement.values()) {
            yield element;
        }
    }

    public * values(): IterableIterator<T> {
        return this.values();
    }

    public * entries(): IterableIterator<[T, T]> {
        for (const element of this._projectionToElement.values()) {
            yield [element, element];
        }
    }

    [Symbol.iterator](): IterableIterator<T> {
        return this.keys();
    }

    public get [Symbol.toStringTag](): 'Set' {
        return 'SetUsingProjection' as 'Set';
    }

    public toString(): string {
        return printSet('SetUsingProjection', this);
    }
}
