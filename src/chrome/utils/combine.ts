import { ValidatedMap } from '../collections/validatedMap';

export function combine<T1, T2>(object1: T1, object2: T2): T1 & T2;
export function combine(...objects: object[]): any {
    const keyToObject = new ValidatedMap<PropertyKey, object>();
    for (const object of objects) {
        for (const key in object) {
            if (!keyToObject.has(key)) {
                keyToObject.set(key, object);
            } else {
                throw new Error(`Can't combine objects into a proxy because both ${object} and ${keyToObject.get(key)} have a property named ${key}`);
            }
        }
    }

    return new Proxy({}, {
        get: (_target: any, key: PropertyKey, _receiver: any): any => {
            const choosenReceiver = keyToObject.get(key) as any;
            return choosenReceiver[key].bind(choosenReceiver);
        }
    });
}

export function combineProperties<T1, T2>(object1: T1, object2: T2): T1 & T2;
export function combineProperties(...objects: object[]): any {
    return Object.assign({}, ...objects);
}