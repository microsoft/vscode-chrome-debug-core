import { ValidatedMap, IValidatedMap } from './validatedMap';
import { IProjection } from './setUsingProjection';
import { printMap } from './printing';

class KeyAndValue<K, V> {
    constructor(public readonly key: K, public readonly value: V) { }
}

/** A map which uses a projection of the key to compare it's elements (This is equivalent to define a custom comparison criteria in other languages) */
export class MapUsingProjection<K, V, P> implements IValidatedMap<K, V> {
    private readonly _projectionToKeyAndvalue: IValidatedMap<P, KeyAndValue<K, V>>;

    constructor(private _projection: IProjection<K, P>, readonly initialContents?: Map<K, V> | Iterable<[K, V]> | ReadonlyArray<[K, V]>) {
        const entries = Array.from(initialContents).map<[P, KeyAndValue<K, V>]>(pair => {
            const projected = this._projection(pair[0]);
            return [projected, new KeyAndValue(pair[0], pair[1])];
        });

        this._projectionToKeyAndvalue = new ValidatedMap<P, KeyAndValue<K, V>>(entries);
    }

    public clear(): void {
        this._projectionToKeyAndvalue.clear();
    }

    public delete(key: K): boolean {
        const keyProjected = this._projection(key);
        return this._projectionToKeyAndvalue.delete(keyProjected);
    }

    public forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
        this._projectionToKeyAndvalue.forEach((keyAndValue) => {
            callbackfn.call(thisArg, keyAndValue.value, keyAndValue.key, this);
        }, thisArg);
    }

    public tryGetting(key: K): V {
        const keyProjected = this._projection(key);
        const keyAndValue = this._projectionToKeyAndvalue.tryGetting(keyProjected);
        return keyAndValue !== undefined ? keyAndValue.value : undefined;
    }

    public get(key: K): V {
        const keyProjected = this._projection(key);
        return this._projectionToKeyAndvalue.get(keyProjected).value;
    }

    public getOrAdd(key: K, obtainValueToAdd: () => V): V {
        const keyProjected = this._projection(key);
        const keyAndValueAdded = this._projectionToKeyAndvalue.getOrAdd(keyProjected, () => new KeyAndValue(key, obtainValueToAdd()));
        return keyAndValueAdded.value;
    }

    public has(key: K): boolean {
        return this.tryGetting(key) !== undefined;
    }

    public set(key: K, value: V): this {
        this._projectionToKeyAndvalue.set(this._projection(key), new KeyAndValue(key, value));
        return this;
    }

    public get size(): number {
        return this._projectionToKeyAndvalue.size;
    }

    public * entries(): IterableIterator<[K, V]> {
        for (const keyAndValue of this._projectionToKeyAndvalue.values()) {
            yield [keyAndValue.key, keyAndValue.value];
        }
    }

    public * keys(): IterableIterator<K> {
        for (const keyAndValue of this._projectionToKeyAndvalue.values()) {
            yield keyAndValue.key;
        }
    }

    public * values(): IterableIterator<V> {
        for (const keyAndValue of this._projectionToKeyAndvalue.values()) {
            yield keyAndValue.value;
        }
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries();
    }

    public get [Symbol.toStringTag](): 'Map' {
        return JSON.stringify(Array.from(this.entries())) as 'Map';
    }

    public toString(): string {
        return printMap('MapUsingProjection', this);
    }
}
