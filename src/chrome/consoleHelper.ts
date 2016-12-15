/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as url from 'url';
import Crdp from '../../crdp/crdp';

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
        // case 'startGroup':
        // case 'startGroupCollapsed':
        //     outputText = '‹Start group›';
        //     const groupTitle = resolveParams(m);
        //     if (groupTitle) {
        //         outputText += ': ' + groupTitle;
        //     }
        //     break;
        // case 'endGroup':
        //     outputText = '‹End group›';
        //     break;
        // case 'trace':
        //     outputText = 'console.trace()\n' + stackTraceToString(m.stackTrace);
        //     break;
        default:
            // Some types we have to ignore
            // outputText = 'Unimplemented console API: ' + m.type;
            break;
    }

    const isError = m.type === 'assert' || m.type === 'error';
    return { args, isError };
}

/**
 * Collapse leading non-object arguments, and apply format specifiers (%s, %d, etc)
 */
function resolveParams(m: Crdp.Runtime.ConsoleAPICalledEvent, skipFormatSpecifiers?: boolean): Crdp.Runtime.RemoteObject[] {
    // Determine the number of leading non-object arguments
    let textArgsIdx = 0;
    while (m.args.length > textArgsIdx && !m.args[textArgsIdx].objectId) {
        textArgsIdx++;
    }

    // No leading text args, return as-is
    if (textArgsIdx === 0) {
        return m.args;
    }

    // There is at least one text arg. Separate them into text and non-text args.
    const textArgs = m.args.slice(0, textArgsIdx);
    const otherArgs = m.args.slice(textArgsIdx);
    const firstTextArg = textArgs.shift();

    // Find all %s, %i, etc in the first argument, which is always the main text. Strip %
    let formatSpecifiers: string[];
    let firstTextArgValue = '' + firstTextArg.value;
    if (firstTextArg.type === 'string' && !skipFormatSpecifiers) {
        formatSpecifiers = (firstTextArgValue.match(/\%[sidfoOc]/g) || [])
            .map(spec => spec[1]);
    } else {
        formatSpecifiers = [];
    }

    // Append all text parameters, formatting properly if there's a format specifier
    textArgs.forEach((param, i) => {
        let formatted: any;
        if (formatSpecifiers[i] === 's') {
            formatted = param.value;
        } else if (['i', 'd'].indexOf(formatSpecifiers[i]) >= 0) {
            formatted = Math.floor(+param.value);
        } else if (formatSpecifiers[i] === 'f') {
            formatted = +param.value;
        } else if (formatSpecifiers[i] === 'c') {
            // %c - Applies CSS color rules
            // Could use terminal color codes in the future
            formatted = '';
        } else if (['o', 'O'].indexOf(formatSpecifiers[i]) >= 0) {
            // Not supported -
            // %o - expandable DOM element
            // %O - expandable JS object
            formatted = param.value;
        }

        // If this param had a format specifier, search and replace it with the formatted param.
        // Otherwise, append it to the end of the text
        if (formatSpecifiers[i]) {
            firstTextArgValue = firstTextArgValue.replace('%' + formatSpecifiers[i], formatted);
        } else {
            firstTextArgValue += ' ' + param.value;
        }
    });

    // Return the collapsed text argument, with all others left alone
    const newFormattedTextArg: Crdp.Runtime.RemoteObject = { type: 'string', value: firstTextArgValue };
    return [newFormattedTextArg, ...otherArgs];
}

function stackTraceToString(stackTrace: Crdp.Runtime.StackTrace): string {
    return stackTrace.callFrames
        .map(frame => {
            const fnName = frame.functionName || (frame.url ? '(anonymous)' : '(eval)');
            const fileName = frame.url ? url.parse(frame.url).pathname : '(eval)';
            return `-  ${fnName} @${fileName}:${frame.lineNumber}`;
        })
        .join('\n');
}
