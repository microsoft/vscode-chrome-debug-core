/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as Crdp } from 'devtools-protocol';
import * as variables from './variables';

export function formatExceptionDetails(e: Crdp.Runtime.ExceptionDetails): string {
    if (!e.exception) {
        return `${e.text || 'Uncaught Error'}\n${stackTraceToString(e.stackTrace)}`;
    }

    return (e.exception.className && e.exception.className.endsWith('Error') && e.exception.description) ||
        (`Error: ${variables.getRemoteObjectPreview(e.exception)}\n${stackTraceToString(e.stackTrace)}`);
}

export function formatConsoleArguments(m: Crdp.Runtime.ConsoleAPICalledEvent): { args: Crdp.Runtime.RemoteObject[], isError: boolean } {
    let args: Crdp.Runtime.RemoteObject[];
    switch (m.type) {
        case 'log':
        case 'debug':
        case 'info':
        case 'error':
        case 'warning':
        case 'dir':
        case 'timeEnd':
        case 'count':
            args = resolveParams(m);
            break;
        case 'assert':
            const formattedParams = m.args.length ?
                // 'assert' doesn't support format specifiers
                resolveParams(m, /*skipFormatSpecifiers=*/true) :
                [];

            const assertMsg = (formattedParams[0] && formattedParams[0].type === 'string') ?
                formattedParams.shift().value :
                '';
            let outputText = `Assertion failed: ${assertMsg}\n` + stackTraceToString(m.stackTrace);

            args = [{ type: 'string', value: outputText }, ...formattedParams];
            break;
        case 'startGroup':
        case 'startGroupCollapsed':
            let startMsg = '‹Start group›';
            const formattedGroupParams = resolveParams(m);
            if (formattedGroupParams.length && formattedGroupParams[0].type === 'string') {
                startMsg += ': ' + formattedGroupParams.shift().value;
            }

            args = [{ type: 'string', value: startMsg}, ...formattedGroupParams];
            break;
        case 'endGroup':
            args = [{ type: 'string', value: '‹End group›' }];
            break;
        case 'trace':
            args = [{ type: 'string', value: 'console.trace()\n' + stackTraceToString(m.stackTrace) }];
            break;
        // case 'clear':
        // Microsoft/vscode-debugadapter-node#185
        // Needs https://github.com/Microsoft/vscode/issues/51245 and https://github.com/Microsoft/vscode/issues/51246
        //     args = [{ type: 'string', value: '\u001b[2J' }];
        //     break;
        default:
            // Some types we have to ignore
            return null;
    }

    const isError = m.type === 'assert' || m.type === 'error';
    return { args, isError };
}

/**
 * Collapse non-object arguments, and apply format specifiers (%s, %d, etc). Return a reduced a formatted list of RemoteObjects.
 */
function resolveParams(m: Crdp.Runtime.ConsoleAPICalledEvent, skipFormatSpecifiers?: boolean): Crdp.Runtime.RemoteObject[] {
    if (!m.args.length || m.args[0].objectId) {
        // If the first arg is not text, nothing is going to happen here
        return m.args;
    }

    // Find all %s, %i, etc in the first argument, which is always the main text. Strip %
    let formatSpecifiers: string[];
    const firstTextArg = m.args.shift();

    // currentCollapsedStringArg is the accumulated text
    let currentCollapsedStringArg = variables.getRemoteObjectPreview(firstTextArg, /*stringify=*/false) + '';
    if (firstTextArg.type === 'string' && !skipFormatSpecifiers) {
        formatSpecifiers = (currentCollapsedStringArg.match(/\%[sidfoOc]/g) || [])
            .map(spec => spec[1]);
    } else {
        formatSpecifiers = [];
    }

    const processedArgs: Crdp.Runtime.RemoteObject[] = [];
    const pushStringArg = (strArg: string) => {
        if (typeof strArg === 'string') {
            processedArgs.push({ type: 'string', value: strArg });
        }
    };

    // Collapse all text parameters, formatting properly if there's a format specifier
    for (let argIdx = 0; argIdx < m.args.length; argIdx++) {
        const arg = m.args[argIdx];

        const formatSpec = formatSpecifiers.shift();
        const formatted = formatArg(formatSpec, arg);

        currentCollapsedStringArg = currentCollapsedStringArg || '';

        if (typeof formatted === 'string') {
            if (formatSpec) {
                // If this param had a format specifier, search and replace it with the formatted param.
                currentCollapsedStringArg = currentCollapsedStringArg.replace('%' + formatSpec, formatted);
            } else {
                currentCollapsedStringArg += (currentCollapsedStringArg ? ' ' + formatted : formatted);
            }
        } else if (formatSpec) {
            // `formatted` is an object - split currentCollapsedStringArg around the current formatSpec and add the object
            const curSpecIdx = currentCollapsedStringArg.indexOf('%' + formatSpec);
            const processedPart = currentCollapsedStringArg.slice(0, curSpecIdx);
            if (processedPart) {
                pushStringArg(processedPart);
            }

            currentCollapsedStringArg = currentCollapsedStringArg.slice(curSpecIdx + 2);
            processedArgs.push(formatted);
        } else {
            pushStringArg(currentCollapsedStringArg);
            currentCollapsedStringArg = null;
            processedArgs.push(formatted);
        }
    }

    pushStringArg(currentCollapsedStringArg);

    return processedArgs;
}

function formatArg(formatSpec: string, arg: Crdp.Runtime.RemoteObject): string | Crdp.Runtime.RemoteObject {
    const paramValue = String(typeof arg.value !== 'undefined' ? arg.value : arg.description);

    if (formatSpec === 's') {
        return paramValue;
    } else if (['i', 'd'].indexOf(formatSpec) >= 0) {
        return Math.floor(+paramValue) + '';
    } else if (formatSpec === 'f') {
        return +paramValue + '';
    } else if (formatSpec === 'c') {
        // Remove %c - Applies CSS color rules
        // Could use terminal color codes in the future
        return '';
    } else if (formatSpec === 'O') {
        if (arg.objectId) {
            return arg;
        } else {
            return paramValue;
        }
    } else {
        // No formatSpec, or unsupported formatSpec:
        // %o - expandable DOM element
        if (arg.objectId) {
            return arg;
        } else {
            return paramValue;
        }
    }
}

function stackTraceToString(stackTrace: Crdp.Runtime.StackTrace): string {
    if (!stackTrace) {
        return '';
    }

    return stackTrace.callFrames
        .map(frame => {
            const fnName = frame.functionName || (frame.url ? '(anonymous)' : '(eval)');
            const fileName = frame.url ? frame.url : 'eval';
            return `    at ${fnName} (${fileName}:${frame.lineNumber + 1}:${frame.columnNumber})`;
        })
        .join('\n');
}
