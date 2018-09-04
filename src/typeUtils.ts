export type MakePropertyRequired<T, K extends keyof T> = T & { [P in K]-?: T[K] };
export type RemoveProperty<T, K> = Pick<T, Exclude<keyof T, K>>;
export type AllRequired<T> = { [P in keyof T]-?: T[P] };
export type AllOptional<T> = { [P in keyof T]+?: T[P] };

// export type Omit<T, K> = Pick<T, Exclude<keyof T, K>>;

// interface A {
//     a?: string;
//     b?: number;
//     c: object;
// }

// const laaf: MakePropertyRequired<A, 'a'>;
// laaf.

// const lala: RemoveProperty<A, 'a'>;
// lala.
// let obj: A = null as A;
// obj.b++;

// let objc: Record<'a' | 'b', A>;
// objc.

export function isIterable<K>(possiblyIterable: any): possiblyIterable is Iterable<K> {
    return possiblyIterable && typeof possiblyIterable[Symbol.iterator] === 'function';
}