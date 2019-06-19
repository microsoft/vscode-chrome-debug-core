// tslint:disable-next-line: no-var-requires
const util = require('util');

const DoNotLogMark = Symbol();

interface HasLoggingMarks {
    [DoNotLogMark]?: boolean;
}

export function shouldLog(object: HasLoggingMarks) {
    return util.types.isProxy(object) || !object || object[DoNotLogMark] !== true;
}

export function DoNotLog(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
    return (target: any, propertyKey: string, _descriptor: PropertyDescriptor) => {
        const method: HasLoggingMarks = target[propertyKey];
        method[DoNotLogMark] = true;
    };
}