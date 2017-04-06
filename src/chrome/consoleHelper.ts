/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as url from 'url';

import Crdp from '../../crdp/crdp';
import * as ChromeUtils from './chromeUtils';

export function formatExceptionDetails(e: Crdp.Runtime.ExceptionDetails): string {
    if (!e.exception) {
        return `${e.text || 'Uncaught Error'}\n${stackTraceToString(e.stackTrace)}`;
    }

    return (e.exception.className && e.exception.className.endsWith('Error') && e.exception.description) ||
        (`Error: ${remoteObjectToString(e.exception)}\n${stackTraceToString(e.stackTrace)}`);
}

export function formatConsoleArguments(m: Crdp.Runtime.ConsoleAPICalledEvent): { args: Crdp.Runtime.RemoteObject[], isError: boolean } {
    // types: log, debug, info, error, warning, dir, dirxml, table, trace, clear,
    // startGroup, startGroupCollapsed, endGroup, assert, profile, profileEnd
    let args: Crdp.Runtime.RemoteObject[];
    switch (m.type) {
        case 'log':
        case 'debug':
        case 'info':
        case 'error':
        case 'warning':
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
        default:
            // Some types we have to ignore
            args = [{ type: 'string', value: 'Unimplemented console API: ' + m.type }];
            break;
    }

    const isError = m.type === 'assert' || m.type === 'error';
    return { args, isError };
}

/**
 * Collapse leading non-object arguments, and apply format specifiers (%s, %d, etc)
 */
function resolveParams(m: Crdp.Runtime.ConsoleAPICalledEvent, skipFormatSpecifiers?: boolean): Crdp.Runtime.RemoteObject[] {
    if (!m.args.length || m.args[0].objectId) {
        // If the first arg is not text, nothing is going to happen here
        return m.args;
    }

    // Find all %s, %i, etc in the first argument, which is always the main text. Strip %
    let formatSpecifiers: string[];
    const firstTextArg = m.args.shift();
    let firstTextArgValue = firstTextArg.value + '';
    if (firstTextArg.type === 'string' && !skipFormatSpecifiers) {
        formatSpecifiers = (firstTextArgValue.match(/\%[sidfoOc]/g) || [])
            .map(spec => spec[1]);
    } else {
        formatSpecifiers = [];
    }

    // Collapse all text parameters, formatting properly if there's a format specifier
    let collapsedArgIdx = 0;
    for (; collapsedArgIdx < m.args.length; collapsedArgIdx++) {
        const param = m.args[collapsedArgIdx];
        if (param.objectId && !formatSpecifiers.length) {
            // If the next arg is an object, and we're done consuming format specifiers, quit
            break;
        }

        const formatSpec = formatSpecifiers.shift();
        let formatted: string;
        const paramValue = typeof param.value !== 'undefined' ? param.value : param.description;
        if (formatSpec === 's') {
            formatted = paramValue;
        } else if (['i', 'd'].indexOf(formatSpec) >= 0) {
            formatted = Math.floor(+paramValue) + '';
        } else if (formatSpec === 'f') {
            formatted = +paramValue + '';
        } else if (formatSpec === 'c') {
            // %c - Applies CSS color rules
            // Could use terminal color codes in the future
            formatted = '';
        } else if (['o', 'O'].indexOf(formatSpec) >= 0) {
            // Not supported -
            // %o - expandable DOM element
            // %O - expandable JS object
            formatted = paramValue;
        }

        // If this param had a format specifier, search and replace it with the formatted param.
        // Otherwise, append it to the end of the text
        if (formatSpec) {
            firstTextArgValue = firstTextArgValue.replace('%' + formatSpec, formatted);
        } else {
            firstTextArgValue += ' ' + param.value;
        }
    }

    // Return the collapsed text argument, with all others left alone
    const newFormattedTextArg: Crdp.Runtime.RemoteObject = { type: 'string', value: firstTextArgValue };
    const otherArgs = m.args.slice(collapsedArgIdx);
    return [newFormattedTextArg, ...otherArgs];
}

function stackTraceToString(stackTrace: Crdp.Runtime.StackTrace): string {
    if (!stackTrace) {
        return '';
    }

    return stackTrace.callFrames
        .map(frame => {
            const fnName = frame.functionName || (frame.url ? '(anonymous)' : '(eval)');
            const fileName = frame.url ? frame.url : 'eval';
            return `    at ${fnName} (${fileName}:${frame.lineNumber}:${frame.columnNumber})`;
        })
        .join('\n');
}

/**
 * TODO - remove dupe code for https://github.com/Microsoft/vscode-chrome-debug-core/issues/163
 */
function remoteObjectToString(obj: Crdp.Runtime.RemoteObject): string {
    const result = ChromeUtils.remoteObjectToValue(obj, /*stringify=*/false);
    if (result.variableHandleRef) {
        if (obj.subtype === 'array') {
            return arrayRemoteObjToString(obj);
        } else if (obj.preview && obj.preview.properties) {
            let props: string = obj.preview.properties
                .map(prop => {
                    let propStr = prop.name + ': ';
                    if (prop.type === 'string') {
                        propStr += `"${prop.value}"`;
                    } else {
                        propStr += prop.value;
                    }

                    return propStr;
                })
                .join(', ');

            if (obj.preview.overflow) {
                props += '…';
            }

            return `${obj.className} {${props}}`;
        }
    }

    return result.value;
}

function arrayRemoteObjToString(obj: Crdp.Runtime.RemoteObject): string {
    if (obj.preview && obj.preview.properties) {
        let props: string = obj.preview.properties
            .map(prop => prop.value)
            .join(', ');

        if (obj.preview.overflow) {
            props += '…';
        }

        return `[${props}]`;
    } else {
        return obj.description;
    }
}