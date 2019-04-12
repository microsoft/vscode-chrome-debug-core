function _printClassDescription(this: Function): string {
    return this.name ? `class ${this.name}` : Function.toString.call(this);
}

export function printClassDescription(functionConstructor: Function) {
    functionConstructor.toString = _printClassDescription;
}