import { isNotEmpty } from './typedOperators';

function _printClassDescription(this: Function): string {
    return isNotEmpty(this.name) ? `class ${this.name}` : Function.toString.call(this);
}

function _printInstanceDescription(this: object): string {
    return isNotEmpty(this.constructor.name) ? `${this.constructor.name}` : 'an anonymous object';
}

export function printClassDescription(functionConstructor: Function) {
    functionConstructor.toString = _printClassDescription;

    /*
     * If the class has the default toString method with returns [object Object] change it for our custom method
     * that returns the class name instead
     */
    if (functionConstructor.prototype.toString === Object.prototype.toString) {
        functionConstructor.prototype.toString = _printInstanceDescription;
    }
}