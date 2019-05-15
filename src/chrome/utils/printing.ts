import { isNotEmpty } from './typedOperators';

function _printClassDescription(this: Function): string {
    return isNotEmpty(this.name) ? `class ${this.name}` : Function.toString.call(this);
}

export function printClassDescription(functionConstructor: Function) {
    functionConstructor.toString = _printClassDescription;
}