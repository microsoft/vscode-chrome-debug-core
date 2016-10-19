/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as url from 'url';
import * as path from 'path';
import Crdp from '../../crdp/crdp';

import * as utils from '../utils';
import {ITarget} from './chromeConnection';

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
    const standardizeMatch = aUrl => {
        // Strip file:///, if present
        aUrl = utils.fileUrlToPath(aUrl).toLowerCase();

        // Strip the protocol, if present
        if (aUrl.indexOf('://') >= 0) aUrl = aUrl.split('://')[1];

        // Need to do a regex match, but URLs can have special regex chars. Escape those.
        return encodeURIComponent(aUrl);
    };

    targetUrlPattern = standardizeMatch(targetUrlPattern).replace(/\*/g, '.*');
    const encodedSlash = encodeURIComponent('/');
    if (!targetUrlPattern.endsWith(encodedSlash)) {
        // Add optional ending slash - so "localhost:3000" will match "localhost:3000/"
        targetUrlPattern += `(${encodedSlash})?`;
    }

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
    return exceptionDetails.exception ? exceptionDetails.exception.description : exceptionDetails.text;
}

/**
 * Get just the error message from the exception details - the first line without the full stack
 */
export function errorMessageFromExceptionDetails(exceptionDetails: Crdp.Runtime.ExceptionDetails): string {
    const description = descriptionFromExceptionDetails(exceptionDetails);
    return description.substr(0, description.indexOf('\n'));
}
