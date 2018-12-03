import { ValidatedMap } from './validatedMap';
import { printMap } from './printing';

/** A multi map that throws exceptions instead of returning error codes. */
export class ValidatedMultiMap<K, V> {
    private readonly _wrappedMap: ValidatedMap<K, Set<V>>;

    public get keysSize(): number {
        return this._wrappedMap.size;
    }

    public get [Symbol.toStringTag](): 'Map' {
        return 'ValidatedMultiMap' as 'Map';
    }

    constructor(initialContents?: Map<K, Set<V>> | Iterable<[K, Set<V>]> | ReadonlyArray<[K, Set<V>]>) {
        this._wrappedMap = initialContents instanceof Map
            ? new ValidatedMap<K, Set<V>>(initialContents.entries())
            : new ValidatedMap<K, Set<V>>(initialContents);
    }

    public clear(): void {
        this._wrappedMap.clear();
    }

    public delete(key: K): boolean {
        return this._wrappedMap.delete(key);
    }

    public forEach(callbackfn: (value: Set<V>, key: K, map: Map<K, Set<V>>) => void, thisArg?: any): void {
        this._wrappedMap.forEach(callbackfn, thisArg);
    }

    public get(key: K): Set<V> {
        return this._wrappedMap.get(key);
    }

    public has(key: K): boolean {
        return this._wrappedMap.has(key);
    }

    public addKeyIfNotExistant(key: K): this {
        const existingValues = this._wrappedMap.tryGetting(key);
        if (existingValues === undefined) {
            this._wrappedMap.set(key, new Set());
        }

        return this;
    }

    public add(key: K, value: V): this {
        const existingValues = this._wrappedMap.tryGetting(key);
        if (existingValues !== undefined) {
            existingValues.add(value);
        } else {
            this._wrappedMap.set(key, new Set([value]));
        }
        return this;
    }

    public remove(key: K, value: V): this {
        const existingValues = this._wrappedMap.get(key);
        if (!existingValues.delete(value)) {
            throw new Error(`Failed to delete the value ${value} under key ${key} because it wasn't present`);
        }

        if (existingValues.size === 0) {
            this._wrappedMap.delete(key);
        }

        return this;
    }

    [Symbol.iterator](): IterableIterator<[K, Set<V>]> {
        return this._wrappedMap.entries();
    }

    public entries(): IterableIterator<[K, Set<V>]> {
        return this._wrappedMap.entries();
    }

    public keys(): IterableIterator<K> {
        return this._wrappedMap.keys();
    }

    public values(): IterableIterator<Set<V>> {
        return this._wrappedMap.values();
    }

    public tryGetting(key: K): Set<V> | null {
        return this._wrappedMap.tryGetting(key);
    }

    public toString(): string {
        return printMap('ValidatedMultiMap', this);
    }
}