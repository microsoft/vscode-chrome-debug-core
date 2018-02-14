/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as url from 'url';
import * as path from 'path';
import Crdp from '../../crdp/crdp';

import * as utils from '../utils';
import {ITarget} from './chromeConnection';

export function targetUrlToClientPathByPathMappings(scriptUrl: string, pathMapping: any, pathMappingOverrides?: {[find: string]: string}): string {
    const parsedUrl = url.parse(scriptUrl);
    if (!parsedUrl.protocol || parsedUrl.protocol.startsWith('file') || !parsedUrl.pathname) {
        // Skip file: URLs and paths, and invalid things
        return '';
    }

    const urlWithoutQuery = parsedUrl.protocol + "//" + parsedUrl.host + parsedUrl.pathname;
    const mappingKeys = Object.keys(pathMapping)
        .sort((a, b) => b.length - a.length);
    const mappingKeyOverrides = Object.keys(pathMappingOverrides || {})
        .sort((a, b) => b.length - a.length);
    for (let pattern of mappingKeys) {
        // empty pattern match nothing use / to match root
        if (pattern) {
            const localPath = pathMapping[pattern];
            const parsedPattern = url.parse(pattern);

            if (parsedPattern.protocol) {
                // pattern is an url with protocol
                if (urlWithoutQuery.startsWith(pattern)) {
                    const clientPath = toClientPath(localPath, parsedUrl.pathname, pattern);
                    if (clientPath) {
                        return clientPath;
                    }
                }
            } else if (pattern[0] === "/") {
                // pattern is absolute
                if (parsedUrl.pathname.startsWith(pattern)) {
                    let clientPath = toClientPath(localPath, parsedUrl.pathname, pattern);
                    if (clientPath) {
                        if (mappingKeyOverrides.length) {
                            for (let patternOverride of mappingKeyOverrides) {
                                clientPath = clientPath.replace(patternOverride, pathMappingOverrides[patternOverride]);
                            }
                        }
                        return clientPath;
                    }
                }
            } else {
                // pattern is relative
                // avoid matching whole segment
                pattern = "/" + pattern;
                const indexOf = parsedUrl.pathname.indexOf(pattern);
                if (indexOf !== -1) {
                    const clientPath = toClientPath(localPath, parsedUrl.pathname.substring(indexOf), pattern);
                    if (clientPath) {
                        return clientPath;
                    }
                }
            }
        }
    }
    return '';
}

function toClientPath(localPath: string, source: string, pattern: string): string {
    if (source.length === pattern.length) {
        return localPath;
    } else {
        // Verify that matching whole segment of the pattern
        if (source[pattern.length - 1] === "/"
            || source[pattern.length] === "/") {
            const r = decodeURIComponent(source.substring(pattern.length));
            return path.join(localPath, r);
        }
    }
    return '';
}

/**
 * Maps a url from target to an absolute local path.
 * If not given an absolute path (with file: prefix), searches the current working directory for a matching file.
 * http://localhost/scripts/code.js => d:/app/scripts/code.js
 * file:///d:/scripts/code.js => d:/scripts/code.js
 */
export function targetUrlToClientPath(webRoot: string, aUrl: string): string {
    if (!aUrl) {
        return '';
    }

    // If the url is an absolute path to a file that exists, return it without file:///.
    // A remote absolute url (cordova) will still need the logic below.
    const canonicalUrl = utils.canonicalizeUrl(aUrl);
    if (aUrl.startsWith('file:///') && utils.existsSync(canonicalUrl)) {
        return canonicalUrl;
    }

    // If we don't have the client workingDirectory for some reason, don't try to map the url to a client path
    if (!webRoot) {
        return '';
    }

    // Search the filesystem under the webRoot for the file that best matches the given url
    let pathName = decodeURIComponent(url.parse(canonicalUrl).pathname);
    if (!pathName || pathName === '/') {
        return '';
    }

    // Dealing with the path portion of either a url or an absolute path to remote file.
    // Need to force path.sep separator
    pathName = pathName.replace(/\//g, path.sep);
    const pathParts = pathName.split(path.sep);
    while (pathParts.length > 0) {
        const clientPath = path.join(webRoot, pathParts.join(path.sep));
        if (utils.existsSync(clientPath)) {
            return utils.canonicalizeUrl(clientPath);
        }

        pathParts.shift();
    }

    return '';
}

/**
 * Convert a RemoteObject to a value+variableHandleRef for the client.
 * TODO - Delete after Microsoft/vscode#12019!!
 */
export function remoteObjectToValue(object: Crdp.Runtime.RemoteObject, stringify = true): { value: string, variableHandleRef?: string } {
    let value = '';
    let variableHandleRef: string;

    if (object) {
        if (object.type === 'object') {
            if (object.subtype === 'null') {
                value = 'null';
            } else {
                // If it's a non-null object, create a variable reference so the client can ask for its props
                variableHandleRef = object.objectId;
                value = object.description;
            }
        } else if (object.type === 'undefined') {
            value = 'undefined';
        } else if (object.type === 'function') {
            const firstBraceIdx = object.description.indexOf('{');
            if (firstBraceIdx >= 0) {
                value = object.description.substring(0, firstBraceIdx) + '{ … }';
            } else {
                const firstArrowIdx = object.description.indexOf('=>');
                value = firstArrowIdx >= 0 ?
                    object.description.substring(0, firstArrowIdx + 2) + ' …' :
                    object.description;
            }
        } else {
            // The value is a primitive value, or something that has a description (not object, primitive, or undefined). And force to be string
            if (typeof object.value === 'undefined') {
                value = object.description;
            } else if (object.type === 'number') {
                // .value is truncated, so use .description, the full string representation
                // Should be like '3' or 'Infinity'.
                value = object.description;
            } else {
                value = stringify ? JSON.stringify(object.value) : object.value;
            }
        }
    }

    return { value, variableHandleRef };
}

/**
 * Returns the targets from the given list that match the targetUrl, which may have * wildcards.
 * Ignores the protocol and is case-insensitive.
 */
export function getMatchingTargets(targets: ITarget[], targetUrlPattern: string): ITarget[] {
    const standardizeMatch = (aUrl: string) => {
        aUrl = aUrl.toLowerCase();
        if (utils.isFileUrl(aUrl)) {
            // Strip file:///, if present
            aUrl = utils.fileUrlToPath(aUrl);
        } else if (utils.isURL(aUrl) && aUrl.indexOf('://') >= 0) {
            // Strip the protocol, if present
            aUrl = aUrl.substr(aUrl.indexOf('://') + 3);
        }

        // Remove optional trailing /
        if (aUrl.endsWith('/')) aUrl = aUrl.substr(0, aUrl.length - 1);

        return aUrl;
    };

    targetUrlPattern = standardizeMatch(targetUrlPattern);
    targetUrlPattern = utils.escapeRegexSpecialChars(targetUrlPattern, '/*').replace(/\*/g, '.*');

    const targetUrlRegex = new RegExp('^' + targetUrlPattern + '$', 'g');
    return targets.filter(target => !!standardizeMatch(target.url).match(targetUrlRegex));
}

const PROTO_NAME = '__proto__';
const NUM_REGEX = /^[0-9]+$/;
export function compareVariableNames(var1: string, var2: string): number {
    // __proto__ at the end
    if (var1 === PROTO_NAME) {
        return 1;
    } else if (var2 === PROTO_NAME) {
        return -1;
    }

    const isNum1 = !!var1.match(NUM_REGEX);
    const isNum2 = !!var2.match(NUM_REGEX);

    if (isNum1 && !isNum2) {
        // Numbers after names
        return 1;
    } else if (!isNum1 && isNum2) {
        // Names before numbers
        return -1;
    } else if (isNum1 && isNum2) {
        // Compare numbers as numbers
        const int1 = parseInt(var1, 10);
        const int2 = parseInt(var2, 10);
        return int1 - int2;
    }

    // Compare strings as strings
    return var1.localeCompare(var2);
}

export function remoteObjectToCallArgument(object: Crdp.Runtime.RemoteObject): Crdp.Runtime.CallArgument {
    return {
        objectId: object.objectId,
        unserializableValue: object.unserializableValue,
        value: object.value
    };
}

/**
 * .exception is not present in Node < 6.6 - TODO this would be part of a generic solution for handling
 * protocol differences in the future.
 * This includes the error message and full stack
 */
export function descriptionFromExceptionDetails(exceptionDetails: Crdp.Runtime.ExceptionDetails): string {
    let description: string;
    if (exceptionDetails.exception) {
        // Take exception object description, or if a value was thrown, the value
        description = exceptionDetails.exception.description ||
            'Error: ' + exceptionDetails.exception.value;
    } else {
        description = exceptionDetails.text;
    }

    return description || '';
}

/**
 * Get just the error message from the exception details - the first line without the full stack
 */
export function errorMessageFromExceptionDetails(exceptionDetails: Crdp.Runtime.ExceptionDetails): string {
    let description = descriptionFromExceptionDetails(exceptionDetails);
    const newlineIdx = description.indexOf('\n');
    if (newlineIdx >= 0) {
        description = description.substr(0, newlineIdx);
    }

    return description;
}

export function getEvaluateName(parentEvaluateName: string, name: string): string {
    if (!parentEvaluateName) return name;

    let nameAccessor: string;
    if (/^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(name)) {
        nameAccessor = '.' + name;
    } else if (/^\d+$/.test(name)) {
        nameAccessor = `[${name}]`;
    } else {
        nameAccessor = `[${JSON.stringify(name)}]`;
    }

    return parentEvaluateName + nameAccessor;
}

export function selectBreakpointLocation(lineNumber: number, columnNumber: number, locations: Crdp.Debugger.BreakLocation[]): Crdp.Debugger.BreakLocation {
    for (let i = locations.length - 1; i >= 0; i--) {
        if (locations[i].columnNumber <= columnNumber) {
            return locations[i];
        }
    }

    return locations[0];
}

export const EVAL_NAME_PREFIX = 'VM';

export function isEvalScript(scriptPath: string): boolean {
    return scriptPath.startsWith(EVAL_NAME_PREFIX);
}

/* Constructs the regex for files to enable break on load
For example, for a file index.js the regex will match urls containing index.js, index.ts, abc/index.ts, index.bin.js etc
It won't match index100.js, indexabc.ts etc */
export function getUrlRegexForBreakOnLoad(url: string): string {
    const fileNameWithoutFullPath = path.parse(url).base;
    const fileNameWithoutExtension = path.parse(fileNameWithoutFullPath).name;
    const escapedFileName = fileNameWithoutExtension.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    return ".*[\\\\\\/]" + escapedFileName + "([^A-z^0-9].*)?$";
}
