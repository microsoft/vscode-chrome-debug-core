import * as util from 'util';

const DoNotLogMark = Symbol();

interface HasLoggingMarks {
    [DoNotLogMark]?: boolean;
}

export function shouldLog<T extends HasLoggingMarks>(object: T, property: string | symbol | number) {
    return property !== 'toString'
        && (util.types.isProxy(object) || !object || object[DoNotLogMark] !== true);
}

export function DoNotLog(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
    return (target: any, propertyKey: string, _descriptor: PropertyDescriptor) => {
        const method: HasLoggingMarks = target[propertyKey];
        method[DoNotLogMark] = true;
    };
}