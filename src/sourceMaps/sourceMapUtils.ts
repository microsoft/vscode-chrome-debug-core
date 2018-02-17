/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import * as url from 'url';

import * as utils from '../utils';
import {logger} from 'vscode-debugadapter';
import {ISourceMapPathOverrides} from '../debugAdapterInterfaces';

/**
 * Resolves a relative path in terms of another file
 */
export function resolveRelativeToFile(absPath: string, relPath: string): string {
    return path.resolve(path.dirname(absPath), relPath);
}

/**
 * Determine the absolute path to the sourceRoot.
 */
export function getComputedSourceRoot(sourceRoot: string, generatedPath: string, webRoot = ''): string {
    let absSourceRoot: string;
    if (sourceRoot) {
        if (sourceRoot.startsWith('file:///')) {
            // sourceRoot points to a local path like "file:///c:/project/src", make it an absolute path
            absSourceRoot = utils.canonicalizeUrl(sourceRoot);
        } else if (sourceRoot.startsWith('/')) {
            // sourceRoot is like "/src", would be like http://localhost/src, resolve to a local path under webRoot
            // note that C:/src (or /src as an absolute local path) is not a valid sourceroot
            absSourceRoot = path.join(webRoot, sourceRoot);
        } else {
            // sourceRoot is like "src" or "../src", relative to the script
            if (path.isAbsolute(generatedPath)) {
                absSourceRoot = resolveRelativeToFile(generatedPath, sourceRoot);
            } else {
                // generatedPath is a URL so runtime script is not on disk, resolve the sourceRoot location on disk
                const genDirname = path.dirname(url.parse(generatedPath).pathname);
                absSourceRoot = path.join(webRoot, genDirname, sourceRoot);
            }
        }

        logger.log(`SourceMap: resolved sourceRoot ${sourceRoot} -> ${absSourceRoot}`);
    } else if (path.isAbsolute(generatedPath)) {
        absSourceRoot = path.dirname(generatedPath);
        logger.log(`SourceMap: no sourceRoot specified, using script dirname: ${absSourceRoot}`);
    } else {
        // runtime script is not on disk, resolve the sourceRoot location on disk
        const urlPath = url.parse(generatedPath).pathname;
        const scriptPathDirname = urlPath ? path.dirname(urlPath) : ''; // could be debugadapter://123, no other info.
        absSourceRoot = path.join(webRoot, scriptPathDirname);
        logger.log(`SourceMap: no sourceRoot specified, using webRoot + script path dirname: ${absSourceRoot}`);
    }

    absSourceRoot = utils.stripTrailingSlash(absSourceRoot);
    absSourceRoot = utils.fixDriveLetterAndSlashes(absSourceRoot);

    return absSourceRoot;
}

/**
 * Applies a set of path pattern mappings to the given path. See tests for examples.
 * Returns something validated to be an absolute path.
 */
export function applySourceMapPathOverrides(sourcePath: string, sourceMapPathOverrides: ISourceMapPathOverrides): string {
    const forwardSlashSourcePath = sourcePath.replace(/\\/g, '/');

    // Sort the overrides by length, large to small
    const sortedOverrideKeys = Object.keys(sourceMapPathOverrides)
        .sort((a, b) => b.length - a.length);

    // Iterate the key/vals, only apply the first one that matches.
    for (let leftPattern of sortedOverrideKeys) {
        const rightPattern = sourceMapPathOverrides[leftPattern];
        const entryStr = `"${leftPattern}": "${rightPattern}"`;

        const asterisks = leftPattern.match(/\*/g) || [];
        if (asterisks.length > 1) {
            logger.log(`Warning: only one asterisk allowed in a sourceMapPathOverrides entry - ${entryStr}`);
            continue;
        }

        const replacePatternAsterisks = rightPattern.match(/\*/g) || [];
        if (replacePatternAsterisks.length > asterisks.length) {
            logger.log(`Warning: the right side of a sourceMapPathOverrides entry must have 0 or 1 asterisks - ${entryStr}}`);
            continue;
        }

        // Does it match?
        const escapedLeftPattern = utils.escapeRegexSpecialChars(leftPattern, '/*');
        const leftRegexSegment = escapedLeftPattern
            .replace(/\*/g, '(.*)')
            .replace(/\\\\/g, '/');
        const leftRegex = new RegExp(`^${leftRegexSegment}$`, 'i');
        const overridePatternMatches = forwardSlashSourcePath.match(leftRegex);
        if (!overridePatternMatches)
            continue;

        // Grab the value of the wildcard from the match above, replace the wildcard in the
        // replacement pattern, and return the result.
        const wildcardValue = overridePatternMatches[1];
        let mappedPath = rightPattern.replace(/\*/g, wildcardValue);
        mappedPath = path.join(mappedPath); // Fix any ..
        logger.log(`SourceMap: mapping ${sourcePath} => ${mappedPath}, via sourceMapPathOverrides entry - ${entryStr}`);
        return mappedPath;
    }

    return sourcePath;
}

export function resolveMapPath(pathToGenerated: string, mapPath: string): string {
    if (!utils.isURL(mapPath)) {
        if (utils.isURL(pathToGenerated)) {
            const scriptUrl = url.parse(pathToGenerated);
            const scriptPath = scriptUrl.pathname;
            if (!scriptPath) {
                return null;
            }

            // runtime script is not on disk, map won't be either, resolve a URL for the map relative to the script
            const mapUrlPathSegment = mapPath.startsWith('/') ? mapPath : path.posix.join(path.dirname(scriptPath), mapPath);
            mapPath = `${scriptUrl.protocol}//${scriptUrl.host}${mapUrlPathSegment}`;
        } else if (path.isAbsolute(pathToGenerated)) {
            // mapPath needs to be resolved to an absolute path or a URL
            // runtime script is on disk, so map should be too
            mapPath = resolveRelativeToFile(pathToGenerated, mapPath);
        }
    }

    return mapPath;
}
