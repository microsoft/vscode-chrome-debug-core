/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import * as Color from 'color';
import * as variables from './variables';
import { CodeFlowStackTrace } from './internal/stackTraces/codeFlowStackTrace';
import { IExceptionDetails } from './cdtpDebuggee/eventsProviders/cdtpExceptionThrownEventsProvider';
import { functionDescription } from './internal/stackTraces/callFramePresentation';
import * as _ from 'lodash';
import { isNotEmpty, isFalse, isDefined, isUndefined, defaultWhenEmpty } from './utils/typedOperators';

export function formatExceptionDetails(e: IExceptionDetails): string {
    if (isUndefined(e.exception)) {
        return `${defaultWhenEmpty(e.text, 'Uncaught Error')}\n${stackTraceToString(e.stackTrace)}`;
    }

    return (`${e.exception.className}`.endsWith('Error') && isNotEmpty(e.exception.description))
        ? e.exception.description
        : `Error: ${variables.getRemoteObjectPreview(e.exception)}\n${stackTraceToString(e.stackTrace)}`;
}

export const clearConsoleCode = '\u001b[2J';

export function formatConsoleArguments(type: CDTP.Runtime.ConsoleAPICalledEvent['type'],
 args: CDTP.Runtime.RemoteObject[], stackTrace?: CodeFlowStackTrace): { args: CDTP.Runtime.RemoteObject[], isError: boolean } | null {
    switch (type) {
        case 'log':
        case 'debug':
        case 'info':
        case 'error':
        case 'warning':
        case 'dir':
        case 'timeEnd':
        case 'count':
            args = resolveParams(args);
            break;
        case 'assert':
            const formattedParams = args.length > 0 ?
                // 'assert' doesn't support format specifiers
                resolveParams(args, /*skipFormatSpecifiers=*/true) :
                [];

            const assertMsg = (formattedParams.length > 0 && formattedParams[0].type === 'string') ?
                formattedParams.shift()!.value :
                '';
            let outputText = `Assertion failed: ${assertMsg}\n` + stackTraceToString(stackTrace);

            args = [{ type: 'string', value: outputText }, ...formattedParams];
            break;
        case 'startGroup':
        case 'startGroupCollapsed':
            let startMsg = '‹Start group›';
            const formattedGroupParams = resolveParams(args);
            if (formattedGroupParams.length > 0 && formattedGroupParams[0].type === 'string') {
                startMsg += ': ' + formattedGroupParams.shift()!.value;
            }

            args = [{ type: 'string', value: startMsg }, ...formattedGroupParams];
            break;
        case 'endGroup':
            args = [{ type: 'string', value: '‹End group›' }];
            break;
        case 'trace':
            args = [{ type: 'string', value: 'console.trace()\n' + stackTraceToString(stackTrace) }];
            break;
        case 'clear':
            args = [{ type: 'string', value: clearConsoleCode }];
            break;
        default:
            // Some types we have to ignore
            return null;
    }

    const isError = type === 'assert' || type === 'error';
    return { args, isError };
}

/**
 * Collapse non-object arguments, and apply format specifiers (%s, %d, etc). Return a reduced a formatted list of RemoteObjects.
 */
function resolveParams(args: CDTP.Runtime.RemoteObject[], skipFormatSpecifiers?: boolean): CDTP.Runtime.RemoteObject[] {
    if (args.length === 0 || isNotEmpty(args[0].objectId)) {
        // If the first arg is not text, nothing is going to happen here
        return args;
    }

    // Find all %s, %i, etc in the first argument, which is always the main text. Strip %
    let formatSpecifiers: string[];
    const firstTextArg = args.shift()!;

    // currentCollapsedStringArg is the accumulated text
    let currentCollapsedStringArg: string | null = variables.getRemoteObjectPreview(firstTextArg, /*stringify=*/false) + '';
    if (firstTextArg.type === 'string' && isFalse(skipFormatSpecifiers)) {
        formatSpecifiers = _.defaultTo(currentCollapsedStringArg.match(/\%[sidfoOc]/g), [] as RegExpMatchArray)
            .map(spec => spec[1]);
    } else {
        formatSpecifiers = [];
    }

    const processedArgs: CDTP.Runtime.RemoteObject[] = [];
    const pushStringArg = (strArg: string | null) => {
        if (typeof strArg === 'string') {
            processedArgs.push({ type: 'string', value: strArg });
        }
    };

    // Collapse all text parameters, formatting properly if there's a format specifier
    for (let argIdx = 0; argIdx < args.length; argIdx++) {
        const arg = args[argIdx];

        const formatSpec = formatSpecifiers.shift();
        const formatted = formatArg(formatSpec, arg);

        currentCollapsedStringArg = _.defaultTo(currentCollapsedStringArg, '');

        if (typeof formatted === 'string') {
            if (isNotEmpty(formatSpec)) {
                // If this param had a format specifier, search and replace it with the formatted param.
                currentCollapsedStringArg = currentCollapsedStringArg.replace('%' + formatSpec, formatted);
            } else {
                currentCollapsedStringArg += (currentCollapsedStringArg === '' ? ' ' + formatted : formatted);
            }
        } else if (isNotEmpty(formatSpec)) {
            // `formatted` is an object - split currentCollapsedStringArg around the current formatSpec and add the object
            const curSpecIdx = currentCollapsedStringArg.indexOf('%' + formatSpec);
            const processedPart = currentCollapsedStringArg.slice(0, curSpecIdx);
            if (isNotEmpty(processedPart)) {
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

function formatArg(formatSpec: string | undefined, arg: CDTP.Runtime.RemoteObject): string | CDTP.Runtime.RemoteObject {
    const paramValue = String(typeof arg.value !== 'undefined' ? arg.value : arg.description);

    if (formatSpec === 's') {
        return paramValue;
    } else if (formatSpec !== undefined && ['i', 'd'].indexOf(formatSpec) >= 0) {
        return Math.floor(+paramValue) + '';
    } else if (formatSpec === 'f') {
        return +paramValue + '';
    } else if (formatSpec === 'c') {
        const cssRegex = /\s*(.*?)\s*:\s*(.*?)\s*(?:;|$)/g;

        let escapedSequence = '';
        let match = cssRegex.exec(arg.value);
        while (match !== null) {
            if (match.length === 3) {
                switch (match[1]) {
                    case 'color':
                        const color = getAnsi16Color(match[2]);
                        if (isDefined(color)) {
                            escapedSequence += `;${color}`;
                        }
                        break;
                    case 'background':
                        const background = getAnsi16Color(match[2]);
                        if (isDefined(background)) {
                            escapedSequence += `;${background + 10}`;
                        }
                        break;
                    case 'font-weight':
                        if (match[2] === 'bold') {
                            escapedSequence += ';1';
                        }
                        break;
                    case 'text-decoration':
                        if (match[2] === 'underline') {
                            escapedSequence += ';4';
                        }
                        break;
                    default:
                        // css not mapped, skip
                }
            }

            match = cssRegex.exec(arg.value);
        }

        if (escapedSequence.length > 0) {
          escapedSequence = `\x1b[0${escapedSequence}m`;
        }

        return escapedSequence;
    } else if (formatSpec === 'O') {
        if (isNotEmpty(arg.objectId)) {
            return arg;
        } else {
            return paramValue;
        }
    } else {
        // No formatSpec, or unsupported formatSpec:
        // %o - expandable DOM element
        if (isNotEmpty(arg.objectId)) {
            return arg;
        } else {
            return paramValue;
        }
    }
}

function stackTraceToString(stackTrace?: CodeFlowStackTrace): string {
    if (isUndefined(stackTrace)) {
        return '';
    }

    return stackTrace.codeFlowFrames
        .map(frame => {
            const fnName = functionDescription(frame.functionName, frame.script.runtimeSource);
            const fileName = frame.script.developmentSource.identifier.textRepresentation;
            return `    at ${fnName} (${fileName}:${frame.lineNumber + 1}:${frame.columnNumber})`;
        })
        .join('\n');
}

function getAnsi16Color(colorString: string): number | undefined {
    try {
      // Color can parse hex and color names
      const color = new Color(colorString);
      return color.ansi16().object().ansi16;
    } catch (ex) {
      // Unable to parse Color
      // For instance, "inherit" color will throw
    }

    return undefined;
}
