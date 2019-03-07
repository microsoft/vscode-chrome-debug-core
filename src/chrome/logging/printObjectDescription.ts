import * as _ from 'lodash';

export function printTopLevelObjectDescription(objectToPrint: unknown) {
    return printObjectDescription(objectToPrint, printFirstLevelProperties);
}

export function printObjectDescription(objectToPrint: unknown, fallbackPrintDescription = (obj: unknown) => `${obj}`) {
    let printted = `<logic to print this object doesn't exist>`;
    if (!objectToPrint) {
        printted = `${objectToPrint}`;
    } else if (typeof objectToPrint === 'object') {
        // Proxies throw an exception when toString is called, so we need to check this first
        if (typeof (<any>objectToPrint).on === 'function') {
            // This is a noice-json-rpc proxy
            printted = 'CDTP Proxy';
        } else {
            const toString = objectToPrint.toString();
            if (toString !== '[object Object]') {
                printted = toString;
            } else if (isJSONObject(objectToPrint)) {
                printted = JSON.stringify(objectToPrint);
            } else if (objectToPrint.constructor === Object) {
                printted = fallbackPrintDescription(objectToPrint);
            } else {
                printted = `${objectToPrint}(${objectToPrint.constructor.name})`;
            }
        }
    } else if (typeof objectToPrint === 'function') {
        if (objectToPrint.name) {
            printted = objectToPrint.name;
        } else {
            const functionSourceCode = objectToPrint.toString();

            // Find param => or (param1, param2)
            const parenthesisIndex = _.findIndex(functionSourceCode, character => character === ')' || character === '=');
            const functionParameters = functionSourceCode.substr(functionSourceCode[0] === '(' ? 1 : 0, parenthesisIndex - 1);
            printted = `Anonymous function: ${functionParameters}`;
        }
    } else {
        printted = `${objectToPrint}`;
    }

    return printted;
}

function isJSONObject(objectToPrint: any): boolean {
    if (objectToPrint.constructor === Object) {
        const values = _.values(objectToPrint);
        return values.every(value => value.constructor === Object);
    } else {
        return false;
    }
}

function printFirstLevelProperties(objectToPrint: any): string {
    const printtedProeprties = Object.keys(objectToPrint).map(key => `${key}: ${printObjectDescription(objectToPrint[key])}`);
    return `{ ${printtedProeprties.join(', ')} }`;
}
