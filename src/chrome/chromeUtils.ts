/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as url from 'url';
import * as path from 'path';
import { Protocol as CDTP } from 'devtools-protocol';
import { logger } from 'vscode-debugadapter';

import * as utils from '../utils';
import { ITarget } from './chromeConnection';
import { IPathMapping } from '../debugAdapterInterfaces';
import { pathToRegex } from '../utils';
import { LocationInScript } from './internal/locations/location';
import { IResourceIdentifier } from './internal/sources/resourceIdentifier';
import { isNotEmpty, isEmpty, isDefined, hasMatches, isUndefined } from './utils/typedOperators';
import * as _ from 'lodash';
import { notEmpty } from '../validation';

/**
 * Takes the path component of a target url (starting with '/') and applies pathMapping
 */
export function applyPathMappingsToTargetUrlPath(scriptUrlPath: string | undefined, pathMapping: IPathMapping | undefined): string {
    if (isUndefined(pathMapping)) {
        return '';
    }

    if (isEmpty(scriptUrlPath) || !scriptUrlPath.startsWith('/')) {
        return '';
    }

    const mappingKeys = Object.keys(pathMapping)
        .sort((a, b) => b.length - a.length);
    for (let pattern of mappingKeys) {
        // empty pattern match nothing use / to match root
        if (isEmpty(pattern)) {
            continue;
        }

        const mappingRHS = pathMapping[pattern];
        if (pattern[0] !== '/') {
            logger.log(`PathMapping keys should be absolute: ${pattern}`);
            pattern = '/' + pattern;
        }

        if (pathMappingPatternMatchesPath(pattern, scriptUrlPath)) {
            return toClientPath(pattern, mappingRHS, scriptUrlPath);
        }
    }

    return '';
}

function pathMappingPatternMatchesPath(pattern: string, scriptPath: string): boolean {
    if (pattern === scriptPath) {
        return true;
    }

    if (!pattern.endsWith('/')) {
        // Don't match /foo with /foobar/something
        pattern += '/';
    }

    return scriptPath.startsWith(pattern);
}

export function applyPathMappingsToTargetUrl(scriptUrl: string, pathMapping: IPathMapping): string {
    const parsedUrl = url.parse(scriptUrl);
    if (isEmpty(parsedUrl.protocol) || parsedUrl.protocol.startsWith('file') || isEmpty(parsedUrl.pathname)) {
        // Skip file: URLs and paths, and invalid things
        return '';
    }

    return applyPathMappingsToTargetUrlPath(parsedUrl.pathname, pathMapping);
}

function toClientPath(pattern: string, mappingRHS: string, scriptPath: string): string {
    const rest = decodeURIComponent(scriptPath.substring(pattern.length));
    const mappedResult = isNotEmpty(rest) ?
        path.join(mappingRHS, rest) :
        mappingRHS;

    return mappedResult;
}

/**
 * Maps a url from target to an absolute local path, if it exists.
 * If not given an absolute path (with file: prefix), searches the current working directory for a matching file.
 * http://localhost/scripts/code.js => d:/app/scripts/code.js
 * file:///d:/scripts/code.js => d:/scripts/code.js
 */
export function targetUrlToClientPath(aUrl: string, pathMapping: IPathMapping | undefined): string {
    if (isEmpty(aUrl)) {
        return '';
    }

    // If the url is an absolute path to a file that exists, return it without file:///.
    // A remote absolute url (cordova) will still need the logic below.
    const canonicalUrl = utils.canonicalizeUrl(aUrl);
    if (utils.isFileUrl(aUrl)) {
        if (utils.existsSync(canonicalUrl)) {
            return canonicalUrl;
        }

        const networkPath = utils.fileUrlToNetworkPath(aUrl);
        if (networkPath !== aUrl && utils.existsSync(networkPath)) {
            return networkPath;
        }
    }

    // Search the filesystem under the webRoot for the file that best matches the given url
    let pathName = url.parse(canonicalUrl).pathname;
    if (isEmpty(pathName) || pathName === '/') {
        return '';
    }

    // Dealing with the path portion of either a url or an absolute path to remote file.
    const pathParts = pathName
        .replace(/^\//, '') // Strip leading /
        .split(/[\/\\]/);
    while (pathParts.length > 0) {
        const joinedPath = '/' + pathParts.join('/');
        const clientPath = applyPathMappingsToTargetUrlPath(joinedPath, pathMapping);
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
export function remoteObjectToValue(object: CDTP.Runtime.RemoteObject, stringify = true): { value: string, variableHandleRef?: string } {
    let value = '';
    let variableHandleRef: string | undefined;

    if (isDefined(object)) {
        if (object.type === 'object') {
            if (object.subtype === 'null') {
                value = 'null';
            } else {
                if (object.description === undefined) {
                    throw new Error(`Expected an remote object of type object to have a description yet it didn't: ${JSON.stringify(object)}`);
                }

                // If it's a non-null object, create a variable reference so the client can ask for its props
                variableHandleRef = object.objectId;
                value = object.description;
            }
        } else if (object.type === 'undefined') {
            value = 'undefined';
        } else if (object.type === 'function') {
            if (object.description === undefined) {
                throw new Error(`Expected a function to have a description yet it didn't: ${JSON.stringify(object)}`);
            }

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
            if (object.description === undefined) {
                throw new Error(`Expected an object that is neither objecr, not function nor undefined to have a description yet it didn't: ${JSON.stringify(object)}`);
            }

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
    return targets.filter(target => target.url !== undefined && hasMatches(standardizeMatch(target.url).match(targetUrlRegex)));
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

    const isNum1 = hasMatches(var1.match(NUM_REGEX));
    const isNum2 = hasMatches(var2.match(NUM_REGEX));

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

export function remoteObjectToCallArgument(object: CDTP.Runtime.RemoteObject): CDTP.Runtime.CallArgument {
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
export function descriptionFromExceptionDetails(exceptionDetails: CDTP.Runtime.ExceptionDetails): string {
    let description: string;
    if (isDefined(exceptionDetails.exception)) {
        // Take exception object description, or if a value was thrown, the value
        description = _.defaultTo(exceptionDetails.exception.description, 'Error: ' + exceptionDetails.exception.value);
    } else {
        description = exceptionDetails.text;
    }

    return _.defaultTo(description, '');
}

/**
 * Get just the error message from the exception details - the first line without the full stack
 */
export function errorMessageFromExceptionDetails(exceptionDetails: CDTP.Runtime.ExceptionDetails): string {
    let description = descriptionFromExceptionDetails(exceptionDetails);
    const newlineIdx = description.indexOf('\n');
    if (newlineIdx >= 0) {
        description = description.substr(0, newlineIdx);
    }

    return description;
}

export function getEvaluateName(parentEvaluateName: string | undefined, name: string): string {
    if (isEmpty(parentEvaluateName)) return name;

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

export function selectBreakpointLocation(_lineNumber: number, columnNumber: number, locations: LocationInScript[]): LocationInScript {
    notEmpty('locations', locations);

    for (let i = locations.length - 1; i >= 0; i--) {
        if (locations[i].position.columnNumber <= columnNumber) {
            return locations[i];
        }
    }

    return locations[0];
}

export const EVAL_NAME_PREFIX = 'VM';

export function isEvalScript(scriptPath: IResourceIdentifier): boolean {
    return scriptPath.canonicalized.startsWith(EVAL_NAME_PREFIX);
}

/* Constructs the regex for files to enable break on load
For example, for a file index.js the regex will match urls containing index.js, index.ts, abc/index.ts, index.bin.js etc
It won't match index100.js, indexabc.ts etc */
export function getUrlRegexForBreakOnLoad(url: IResourceIdentifier): string {
    const fileNameWithoutFullPath = path.parse(url.canonicalized).base;
    const fileNameWithoutExtension = path.parse(fileNameWithoutFullPath).name;
    const escapedFileName = pathToRegex(fileNameWithoutExtension);
    return '.*[\\\\\\/]' + escapedFileName + '([^A-z^0-9].*)?$';
}
