/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import * as url from 'url';
import { logger } from 'vscode-debugadapter';

import * as chromeUtils from '../chrome/chromeUtils';
import * as utils from '../utils';
import { ISourceMapPathOverrides, IPathMapping } from '../debugAdapterInterfaces';

/**
 * Resolves a relative path in terms of another file
 */
export function resolveRelativeToFile(absPath: string, relPath: string): string {
    return utils.properResolve(path.dirname(absPath), relPath);
}

/**
 * Determine an absolute path for the sourceRoot.
 */
export function getComputedSourceRoot(sourceRoot: string, generatedPath: string, pathMapping: IPathMapping = {}): string {
    generatedPath = utils.fileUrlToPath(generatedPath);

    let absSourceRoot: string;
    if (sourceRoot) {
        if (sourceRoot.startsWith('file:///')) {
            // sourceRoot points to a local path like "file:///c:/project/src", make it an absolute path
            absSourceRoot = utils.canonicalizeUrl(sourceRoot);
        } else if (utils.isAbsolute(sourceRoot)) {
            // sourceRoot is like "/src", should be like http://localhost/src, resolve to a local path using pathMaping.
            // If path mappings do not apply (e.g. node), assume that sourceRoot is actually a local absolute path.
            // Technically not valid but it's easy to end up with paths like this.
            absSourceRoot = chromeUtils.applyPathMappingsToTargetUrlPath(sourceRoot, pathMapping) || sourceRoot;

            // If no pathMapping (node), use sourceRoot as is.
            // But we also should handle an absolute sourceRoot for chrome? Does CDT handle that? No it does not, it interprets it as "localhost/full path here"
        } else if (path.isAbsolute(generatedPath)) {
            // sourceRoot is like "src" or "../src", relative to the script
            absSourceRoot = resolveRelativeToFile(generatedPath, sourceRoot);
        } else {
            // generatedPath is a URL so runtime script is not on disk, resolve the sourceRoot location on disk.
            const generatedUrlPath = url.parse(generatedPath).pathname;
            const mappedPath = chromeUtils.applyPathMappingsToTargetUrlPath(generatedUrlPath, pathMapping);
            const mappedDirname = path.dirname(mappedPath);
            absSourceRoot = utils.properJoin(mappedDirname, sourceRoot);
        }

        logger.log(`SourceMap: resolved sourceRoot ${sourceRoot} -> ${absSourceRoot}`);
    } else if (path.isAbsolute(generatedPath)) {
        absSourceRoot = path.dirname(generatedPath);
        logger.log(`SourceMap: no sourceRoot specified, using script dirname: ${absSourceRoot}`);
    } else {
        // No sourceRoot and runtime script is not on disk, resolve the sourceRoot location on disk
        const urlPathname = url.parse(generatedPath).pathname || '/placeholder.js';  // could be debugadapter://123, no other info.
        const mappedPath = chromeUtils.applyPathMappingsToTargetUrlPath(urlPathname, pathMapping);
        const scriptPathDirname = mappedPath ? path.dirname(mappedPath) : '';
        absSourceRoot = scriptPathDirname;
        logger.log(`SourceMap: no sourceRoot specified, using webRoot + script path dirname: ${absSourceRoot}`);
    }

    absSourceRoot = utils.stripTrailingSlash(absSourceRoot);
    absSourceRoot = utils.fixDriveLetterAndSlashes(absSourceRoot);

    return absSourceRoot;
}

let aspNetFallbackCount = 0;
export function getAspNetFallbackCount(): number {
    return aspNetFallbackCount;
}

/**
 * Applies a set of path pattern mappings to the given path. See tests for examples.
 * Returns something validated to be an absolute path.
 */
export function applySourceMapPathOverrides(sourcePath: string, sourceMapPathOverrides: ISourceMapPathOverrides, isVSClient = false): string {
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
        mappedPath = utils.properJoin(mappedPath); // Fix any ..
        if (isVSClient && leftPattern === 'webpack:///./*' && !utils.existsSync(mappedPath)) {
            // This is a workaround for a bug in ASP.NET debugging in VisualStudio because the wwwroot is not properly configured
            const pathFixingASPNETBug = path.join(rightPattern.replace(/\*/g, path.join('../ClientApp', wildcardValue)));
            if (utils.existsSync(pathFixingASPNETBug)) {
                ++aspNetFallbackCount;
                mappedPath = pathFixingASPNETBug;
            }
        }

        logger.log(`SourceMap: mapping ${sourcePath} => ${mappedPath}, via sourceMapPathOverrides entry - ${entryStr}`);
        return mappedPath;
    }

    return sourcePath;
}

export function resolveMapPath(pathToGenerated: string, mapPath: string, pathMapping: IPathMapping): string {
    if (!utils.isURL(mapPath)) {
        if (utils.isURL(pathToGenerated)) {
            const scriptUrl = url.parse(pathToGenerated);
            const scriptPath = scriptUrl.pathname;
            if (!scriptPath) {
                return null;
            }

            // runtime script is not on disk, map won't be either, resolve a URL for the map relative to the script
            // handle c:/ here too
            const mapUrlPathSegment = utils.isAbsolute(mapPath) ?
                mapPath :
                path.posix.join(path.dirname(scriptPath), mapPath);
            mapPath = `${scriptUrl.protocol}//${scriptUrl.host}${mapUrlPathSegment}`;
        } else if (utils.isAbsolute(mapPath)) {
            mapPath = chromeUtils.applyPathMappingsToTargetUrlPath(mapPath, pathMapping) || mapPath;
        } else if (path.isAbsolute(pathToGenerated)) {
            // mapPath needs to be resolved to an absolute path or a URL
            // runtime script is on disk, so map should be too
            mapPath = resolveRelativeToFile(pathToGenerated, mapPath);
        }
    }

    return mapPath;
}

export function getFullSourceEntry(sourceRoot: string | undefined, sourcePath: string): string {
    if (!sourceRoot) {
        return sourcePath;
    }

    if (!sourceRoot.endsWith('/')) {
        sourceRoot += '/';
    }

    return sourceRoot + sourcePath;
}
