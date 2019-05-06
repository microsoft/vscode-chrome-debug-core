/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as url from 'url';
import * as path from 'path';
import * as glob from 'glob';
import { logger } from 'vscode-debugadapter';
import * as http from 'http';
import * as https from 'https';

import { IExecutionResultTelemetryProperties } from './telemetry';
import { ValidatedSet } from './chrome/collections/validatedSet';
import { promisify } from 'util';
import { isDefined, hasMatches, hasNoMatches, isNotEmpty, isTrue, isEmpty } from './chrome/utils/typedOperators';
import _ = require('lodash');

export interface IStringDictionary<T> {
    [name: string]: T;
}

export const enum Platform {
    Windows, OSX, Linux
}

export function getPlatform(): Platform {
    const platform = os.platform();
    return platform === 'darwin' ? Platform.OSX :
        platform === 'win32' ? Platform.Windows :
            Platform.Linux;
}

/**
 * Node's fs.existsSync is deprecated, implement it in terms of statSync
 */
export function existsSync(path: string): boolean {
    try {
        fs.statSync(path);
        return true;
    } catch (e) {
        // doesn't exist
        return false;
    }
}

/**
 * Checks asynchronously if a path exists on the disk.
 */
export function existsAsync(path: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            fs.access(path, (err?: NodeJS.ErrnoException) => {
                resolve(isDefined(err) ? false : true);
            });
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * Returns a reversed version of arr. Doesn't modify the input.
 */
export function reversedArr(arr: any[]): any[] {
    return arr.reduce((reversed: any[], x: any) => {
        reversed.unshift(x);
        return reversed;
    }, []);
}

export function promiseTimeout(p?: Promise<any>, timeoutMs = 1000, timeoutMsg?: string): Promise<any> {
    if (timeoutMsg === undefined) {
        timeoutMsg = `Promise timed out after ${timeoutMs}ms`;
    }

    return new Promise((resolve, reject) => {
        if (isDefined(p)) {
            p.then(resolve, reject);
        }

        setTimeout(() => {
            if (isDefined(p)) {
                reject(new Error(timeoutMsg));
            } else {
                resolve();
            }
        }, timeoutMs);
    });
}

export function retryAsync(fn: () => Promise<any>, timeoutMs: number, intervalDelay = 0): Promise<any> {
    const startTime = Date.now();

    function tryUntilTimeout(): Promise<any> {
        return fn().catch(
            e => {
                if (Date.now() - startTime < (timeoutMs - intervalDelay)) {
                    return promiseTimeout(undefined, intervalDelay).then(tryUntilTimeout);
                } else {
                    return errP(e);
                }
            });
    }

    return tryUntilTimeout();
}

let caseSensitivePaths = true;
export function setCaseSensitivePaths(useCaseSensitivePaths: boolean) {
    caseSensitivePaths = useCaseSensitivePaths;
}

/**
 * Modify a url/path either from the client or the target to a common format for comparing.
 * The client can handle urls in this format too.
 * file:///D:\\scripts\\code.js => d:/scripts/code.js
 * file:///Users/me/project/code.js => /Users/me/project/code.js
 * c:/scripts/code.js => c:\\scripts\\code.js
 * http://site.com/scripts/code.js => (no change)
 * http://site.com/ => http://site.com
 */
export function canonicalizeUrl(urlOrPath: string): string {
    urlOrPath = fileUrlToPath(urlOrPath);

    // Remove query params
    if (urlOrPath.indexOf('?') >= 0) {
        urlOrPath = urlOrPath.split('?')[0];
    }

    urlOrPath = stripTrailingSlash(urlOrPath);
    urlOrPath = fixDriveLetterAndSlashes(urlOrPath);
    if (!caseSensitivePaths) {
        urlOrPath = normalizeIfFSIsCaseInsensitive(urlOrPath);
    }

    return urlOrPath;
}

function normalizeIfFSIsCaseInsensitive(urlOrPath: string): string {
    return isWindowsFilePath(urlOrPath)
        ? urlOrPath.toLowerCase()
        : urlOrPath;
}

function isWindowsFilePath(candidate: string): boolean {
    return hasMatches(candidate.match(/[A-z]:[\\\/][^\\\/]/));
}

export function isFileUrl(candidate: string): boolean {
    return candidate.startsWith('file:///');
}

/**
 * If urlOrPath is a file URL, removes the 'file:///', adjusting for platform differences
 */
export function fileUrlToPath(urlOrPath: string): string {
    if (isFileUrl(urlOrPath)) {
        urlOrPath = urlOrPath.replace('file:///', '');
        urlOrPath = decodeURIComponent(urlOrPath);
        if (urlOrPath[0] !== '/' && hasNoMatches(urlOrPath.match(/^[A-Za-z]:/))) {
            // If it has a : before the first /, assume it's a windows path or url.
            // Ensure unix-style path starts with /, it can be removed when file:/// was stripped.
            // Don't add if the url still has a protocol
            urlOrPath = '/' + urlOrPath;
        }

        urlOrPath = fixDriveLetterAndSlashes(urlOrPath);
    }

    return urlOrPath;
}

export function fileUrlToNetworkPath(urlOrPath: string): string {
    if (isFileUrl(urlOrPath)) {
        urlOrPath = urlOrPath.replace('file:///', '\\\\');
        urlOrPath = urlOrPath.replace(/\//g, '\\');
        urlOrPath = urlOrPath = decodeURIComponent(urlOrPath);
    }

    return urlOrPath;
}

/**
 * Replace any backslashes with forward slashes
 * blah\something => blah/something
 */
export function forceForwardSlashes(aUrl: string): string {
    return aUrl
        .replace(/\\\//g, '/') // Replace \/ (unnecessarily escaped forward slash)
        .replace(/\\/g, '/');
}

/**
 * Ensure lower case drive letter and \ on Windows
 */
export function fixDriveLetterAndSlashes(aPath: string, uppercaseDriveLetter = false): string {
    aPath = fixDriveLetter(aPath, uppercaseDriveLetter);
    if (hasMatches(aPath.match(/file:\/\/\/[A-Za-z]:/))) {
        const prefixLen = 'file:///'.length;
        aPath =
            aPath.substr(0, prefixLen + 1) +
            aPath.substr(prefixLen + 1).replace(/\//g, '\\');
    } else if (hasMatches(aPath.match(/^[A-Za-z]:/))) {
        aPath = aPath.replace(/\//g, '\\');
    }

    return aPath;
}

export function fixDriveLetter(aPath: string, uppercaseDriveLetter = false): string {
    if (hasMatches(aPath.match(/file:\/\/\/[A-Za-z]:/))) {
        const prefixLen = 'file:///'.length;
        aPath =
            'file:///' +
            aPath[prefixLen].toLowerCase() +
            aPath.substr(prefixLen + 1);
    } else if (aPath.match(/^[A-Za-z]:/) !== null) {
        // If the path starts with a drive letter, ensure lowercase. VS Code uses a lowercase drive letter
        const driveLetter = uppercaseDriveLetter ? aPath[0].toUpperCase() : aPath[0].toLowerCase();
        aPath = driveLetter + aPath.substr(1);
    }

    return aPath;
}

/**
 * Remove a slash of any flavor from the end of the path
 */
export function stripTrailingSlash(aPath: string): string {
    return aPath
        .replace(/\/$/, '')
        .replace(/\\$/, '');
}

/**
 * A helper for returning a rejected promise with an Error object. Avoids double-wrapping an Error, which could happen
 * when passing on a failure from a Promise error handler.
 * @param msg - Should be either a string or an Error
 */
export function errP(msg?: string | Error): Promise<never> {
    const isErrorLike = (thing: any): thing is Error => !!thing.message;

    let e: Error;
    if (msg === undefined) {
        e = new Error('Unknown error');
    } else if (isErrorLike(msg)) {
        // msg is already an Error object
        e = msg;
    } else {
        e = new Error(msg);
    }

    return Promise.reject(e);
}

/**
 * Helper function to GET the contents of a url
 */
export function getURL(aUrl: string, options: https.RequestOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(aUrl);
        const get = parsedUrl.protocol === 'https:' ? https.get : http.get;
        options = <https.RequestOptions>{
            rejectUnauthorized: false,
            ...parsedUrl,
            ...options
        };

        get(options, response => {
            let responseData = '';
            response.on('data', chunk => responseData += chunk);
            response.on('end', () => {
                // Sometimes the 'error' event is not fired. Double check here.
                if (response.statusCode === 200) {
                    resolve(responseData);
                } else {
                    logger.log(`HTTP GET failed with: ${response.statusCode} ${response.statusMessage}`);
                    reject(new Error(responseData.trim()));
                }
            });
        }).on('error', e => {
            logger.log('HTTP GET failed: ' + e.toString());
            reject(e);
        });
    });
}

/**
 * Returns true if urlOrPath is like "http://localhost" and not like "c:/code/file.js" or "/code/file.js"
 */
export function isURL(urlOrPath?: string): boolean {
    // Warning: url.parse(urlOrPath).protocol typing is wrong and it can actually be null
    return isNotEmpty(urlOrPath) && !path.isAbsolute(urlOrPath) && isNotEmpty(url.parse(urlOrPath).protocol);
}

export function isAbsolute(_path: string): boolean {
    return path.posix.isAbsolute(_path) || path.win32.isAbsolute(_path);
}

/**
 * Strip a string from the left side of a string
 */
export function lstrip(s: string, lStr: string): string {
    return s.startsWith(lStr) ?
        s.substr(lStr.length) :
        s;
}

/**
 * Convert a local path to a file URL, like
 * C:/code/app.js => file:///C:/code/app.js
 * /code/app.js => file:///code/app.js
 * \\code\app.js => file:///code/app.js
 */
export function pathToFileURL(_absPath: string, normalize?: boolean): string {
    let absPath = forceForwardSlashes(_absPath);
    if (isTrue(normalize)) {
        absPath = path.normalize(absPath);
        absPath = forceForwardSlashes(absPath);
    }

    const filePrefix = _absPath.startsWith('\\\\') ? 'file:/' :
        absPath.startsWith('/') ? 'file://' :
            'file:///';

    absPath = filePrefix + absPath;
    return encodeURI(absPath);
}

export function fsReadDirP(path: string): Promise<string[]> {
    return promisify(fs.readdir)(path);
}

export function readFileP(path: string, encoding = 'utf8'): Promise<string> {
    return promisify(fs.readFile)(path, encoding);
}

export async function writeFileP(filePath: string, data: string): Promise<void> {
    await mkdirs(path.dirname(filePath));
    return promisify(fs.writeFile)(filePath, data);
}

/**
 * Make sure that all directories of the given path exist (like mkdir -p).
 */
export function mkdirs(dirsPath: string): void {
    if (!fs.existsSync(dirsPath)) {
        mkdirs(path.dirname(dirsPath));
        fs.mkdirSync(dirsPath);
    }
}

// ---- globbing support -------------------------------------------------
export function extendObject<T>(objectCopy: T, object: T): T {
    for (let key in object) {
        if (object.hasOwnProperty(key)) {
            objectCopy[key] = object[key];
        }
    }

    return objectCopy;
}

function isExclude(pattern: string): boolean {
    return pattern[0] === '!';
}

interface IGlobTask {
    pattern: string;
    opts: any;
}

export function multiGlob(patterns: string[], opts?: any): Promise<string[]> {
    const globTasks: IGlobTask[] = [];

    opts = extendObject({
        cache: Object.create(null),
        statCache: Object.create(null),
        realpathCache: Object.create(null),
        symlinks: Object.create(null),
        ignore: []
    }, opts);

    try {
        patterns.forEach((pattern, i) => {
            if (isExclude(pattern)) {
                return;
            }

            const ignore = patterns.slice(i).filter(isExclude).map(excludePattern => {
                return excludePattern.slice(1);
            });

            globTasks.push({
                pattern,
                opts: extendObject(extendObject({}, opts), {
                    ignore: opts.ignore.concat(ignore)
                })
            });
        });
    } catch (err) {
        return Promise.reject(err);
    }

    return Promise.all(globTasks.map(task => {
        return promisify(glob)(task.pattern, task.opts);
    })).then(results => {
        const set = new Set<string>();
        for (let paths of results) {
            for (let p of paths) {
                set.add(p);
            }
        }

        let array: string[] = [];
        set.forEach(v => array.push(fixDriveLetterAndSlashes(v)));
        return array;
    });
}

/**
 * Return a regex for the given path to set a breakpoint on
 */
export function pathToRegex(aPath: string, guid = ''): string {
    const fileUrlPrefix = 'file:///';
    const isFileUrl = aPath.startsWith(fileUrlPrefix);
    const isAbsolutePath = isAbsolute(aPath);
    if (isFileUrl) {
        // Purposely avoiding fileUrlToPath/pathToFileUrl for this, because it does decodeURI/encodeURI
        // for special URL chars and I don't want to think about that interacting with special regex chars.
        // Strip file://, process as a regex, then add file: back at the end.
        aPath = aPath.substr(fileUrlPrefix.length);
    }

    if (isURL(aPath) || isFileUrl || !isAbsolutePath) {
        aPath = escapeRegexSpecialChars(aPath);
    } else {
        const escapedAPath = escapeRegexSpecialChars(aPath);
        aPath = `${escapedAPath}|${escapeRegexSpecialChars(pathToFileURL(aPath))}`;
    }

    // If we should resolve paths in a case-sensitive way, we still need to set the BP for either an
    // upper or lowercased drive letter
    if (caseSensitivePaths) {
        aPath = aPath.replace(/(^|file:\\\/\\\/\\\/)([a-zA-Z]):/g, (_match, prefix, letter) => {
            const u = letter.toUpperCase();
            const l = letter.toLowerCase();
            return `${prefix}[${u}${l}]:`;
        });
    } else {
        aPath = aPath.replace(/[a-zA-Z]/g, letter => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
    }

    if (isFileUrl) {
        aPath = escapeRegexSpecialChars(fileUrlPrefix) + aPath;
    }

    if (guid !== '') {
        // Add a guid to the regexp to make it unique, without modifying what it matches. This will allow us to add duplicated breakpoints using CDTP
        aPath = aPath + `(?:${guid}){0}`;
    }

    return aPath;
}

export function pathGlobToBlackboxedRegex(glob: string): string {
    return escapeRegexSpecialChars(glob, '*')
        .replace(/([^*]|^)\*([^*]|$)/g, '$1.*$2') // * -> .*
        .replace(/\*\*(\\\/|\\\\)?/g, '(.*\\\/)?') // **/ -> (.*\/)?

        // Just to simplify
        .replace(/\.\*\\\/\.\*/g, '.*') // .*\/.* -> .*
        .replace(/\.\*\.\*/g, '.*') // .*.* -> .*

        // Match either slash direction
        .replace(/\\\/|\\\\/g, '[\/\\\\]'); // / -> [/|\], \ -> [/|\]
}

const regexChars = '/\\.?*()^${}|[]+';
export function escapeRegexSpecialChars(str: string, except?: string): string {
    const useRegexChars = regexChars
        .split('')
        .filter(c => isEmpty(except) || except.indexOf(c) < 0)
        .join('')
        .replace(/[\\\]]/g, '\\$&');

    const r = new RegExp(`[${useRegexChars}]`, 'g');
    return str.replace(r, '\\$&');
}

export function trimLastNewline(str: string): string {
    return str.replace(/(\n|\r\n)$/, '');
}

export function prettifyNewlines(str: string): string {
    return str.replace(/(\n|\r\n)/, '\\n');
}

function blackboxNegativeLookaheadPattern(aPath: string): string {
    return `(?!${escapeRegexSpecialChars(aPath)})`;
}

export function makeRegexNotMatchPath(regex: RegExp, aPath: string): RegExp {
    if (regex.test(aPath)) {
        const regSourceWithoutCaret = regex.source.replace(/^\^/, '');
        const source = `^${blackboxNegativeLookaheadPattern(aPath)}.*(${regSourceWithoutCaret})`;
        return new RegExp(source, 'i');
    } else {
        return regex;
    }
}

export function makeRegexMatchPath(regex: RegExp, aPath: string): RegExp {
    const negativePattern = blackboxNegativeLookaheadPattern(aPath);
    if (regex.source.indexOf(negativePattern) >= 0) {
        const newSource = regex.source.replace(negativePattern, '');
        return new RegExp(newSource, 'i');
    } else {
        return regex;
    }
}

export function uppercaseFirstLetter(str: string): string {
    return str.substr(0, 1).toUpperCase() + str.substr(1);
}

export function getLine(msg: string, n = 0): string {
    return msg.split('\n')[n];
}

export function firstLine(msg: string | undefined): string {
    return getLine(_.defaultTo(msg, ''));
}

export function isNumber(num: any): boolean {
    return typeof num === 'number';
}

export function toVoidP(p: Promise<any>): Promise<void> {
    return p.then(() => { });
}

type ResolveType<T> = (value?: T | PromiseLike<T>) => void;
type RejectType = (reason?: any) => void;

export interface IPromiseDefer<T> {
    readonly promise: Promise<T>;
    resolve: ResolveType<T>;
    reject: RejectType;
}

export function promiseDefer<T>(): IPromiseDefer<T> {
    // If we hit any of these two functions, it means that the variables weren't initialized inside the new Promise(){ ... }
    let resolveCallback: ResolveType<T> = () => { throw new Error(`promiseDefer is not initializing resolveCallback properly`); };
    let rejectCallback: RejectType = () => { throw new Error(`promiseDefer is not initializing rejectCallback properly`); };

    const promise = new Promise<T>((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
    });

    return { promise, resolve: resolveCallback, reject: rejectCallback };
}

export type HighResTimer = [number, number];

export function calculateElapsedTime(startProcessingTime: HighResTimer): number {
    const NanoSecondsPerMillisecond = 1000000;
    const NanoSecondsPerSecond = 1e9;

    const ellapsedTime = process.hrtime(startProcessingTime);
    const ellapsedMilliseconds = (ellapsedTime[0] * NanoSecondsPerSecond + ellapsedTime[1]) / NanoSecondsPerMillisecond;
    return ellapsedMilliseconds;
}

// Pattern: The pattern recognizes file paths and captures the file name and the colon at the end.
// Next line is a sample path aligned with the regexp parts that recognize it/match it. () is for the capture group
//                                C  :     \  foo      \  (in.js:)
//                                C  :     \  foo\ble  \  (fi.ts:)
const extractFileNamePattern = /[A-z]:(?:[\\/][^:]*)+[\\/]([^:]*:)/g;

export function fillErrorDetails(properties: IExecutionResultTelemetryProperties, e: any): void {
    properties.exceptionMessage = e.message || e.toString();
    if (e.name) {
        properties.exceptionName = e.name;
    }
    if (typeof e.stack === 'string') {
        let unsanitizedStack = e.stack;
        try {
            // We remove the file path, we just leave the file names
            unsanitizedStack = unsanitizedStack.replace(extractFileNamePattern, '$1');
        } catch (exception) {
            // Ignore error while sanitizing the call stack
        }
        properties.exceptionStack = unsanitizedStack;
    }
    if (e.id) {
        properties.exceptionId = e.id.toString();
    }
}

export function makeUnique<T>(elements: T[]): T[] {
    return Array.from(new ValidatedSet(elements));
}

export function defaultIfUndefined<T>(value: T | undefined, defaultValue: T): T {
    return value !== undefined ? value : defaultValue;
}