/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as fs from 'fs';

import * as sourceMapUtils from './sourceMapUtils';
import * as utils from '../utils';
import * as logger from '../logger';
import {SourceMap} from './sourceMap';
import {ISourceMapPathOverrides} from '../debugAdapterInterfaces';

/**
 * pathToGenerated - an absolute local path or a URL.
 * mapPath - a path relative to pathToGenerated.
 */
export function getMapForGeneratedPath(pathToGenerated: string, mapPath: string, webRoot?: string, sourceMapPathOverrides?: ISourceMapPathOverrides): Promise<SourceMap> {
    let msg = `SourceMaps.getMapForGeneratedPath: Finding SourceMap for ${pathToGenerated} by URI: ${mapPath}`;
    if (webRoot) {
        msg += ` and webRoot: ${webRoot}`;
    }

    logger.log(msg);

    // For an inlined sourcemap, mapPath is a data URI containing a blob of base64 encoded data, starting
    // with a tag like "data:application/json;charset:utf-8;base64,". The data should start after the last comma.
    let sourceMapContentsP: Promise<string>;
    if (mapPath.indexOf('data:application/json') >= 0) {
        // Sourcemap is inlined
        logger.log(`SourceMaps.getMapForGeneratedPath: Using inlined sourcemap in ${pathToGenerated}`);
        sourceMapContentsP = Promise.resolve(getInlineSourceMapContents(mapPath));
    } else {
        sourceMapContentsP = getSourceMapContent(pathToGenerated, mapPath);
    }

    return sourceMapContentsP.then(contents => {
        if (contents) {
            try {
                // Throws for invalid JSON
                return new SourceMap(pathToGenerated, contents, webRoot, sourceMapPathOverrides);
            } catch (e) {
                logger.error(`SourceMaps.getMapForGeneratedPath: exception while processing sourcemap: ${e.stack}`);
                return null;
            }
        } else {
            return null;
        }
    });
}

/**
 * Parses sourcemap contents from inlined base64-encoded data
 */
function getInlineSourceMapContents(sourceMapData: string): string {
    const lastCommaPos = sourceMapData.lastIndexOf(',');
    if (lastCommaPos < 0) {
        logger.log(`SourceMaps.getInlineSourceMapContents: Inline sourcemap is malformed. Starts with: ${sourceMapData.substr(0, 200)}`);
        return null;
    }

    const data = sourceMapData.substr(lastCommaPos + 1);
    try {
        const buffer = new Buffer(data, 'base64');
        return buffer.toString();
    } catch (e) {
        logger.error(`SourceMaps.getInlineSourceMapContents: exception while processing data uri (${e.stack})`);
    }

    return null;
}

/**
 * Resolves a sourcemap's path and loads the data
 */
function getSourceMapContent(pathToGenerated: string, mapPath: string): Promise<string> {
    mapPath = sourceMapUtils.resolveMapPath(pathToGenerated, mapPath);

    return loadSourceMapContents(mapPath).then(contents => {
        if (!contents) {
            // Last ditch effort - just look for a .js.map next to the script
            const mapPathNextToSource = pathToGenerated + '.map';
            if (mapPathNextToSource !== mapPath) {
                return loadSourceMapContents(mapPathNextToSource);
            }
        }

        return contents;
    });
}

function loadSourceMapContents(mapPathOrURL: string): Promise<string> {
    let contentsP: Promise<string>;
    if (utils.isURL(mapPathOrURL)) {
        logger.log(`SourceMaps.loadSourceMapContents: Downloading sourcemap file from ${mapPathOrURL}`);
        contentsP = downloadSourceMapContents(mapPathOrURL).catch(e => {
            logger.error(`SourceMaps.loadSourceMapContents: Could not download sourcemap from ${mapPathOrURL}`);
            return null;
        });
    } else {
        contentsP = new Promise((resolve, reject) => {
            logger.log(`SourceMaps.loadSourceMapContents: Reading local sourcemap file from ${mapPathOrURL}`);
            fs.readFile(mapPathOrURL, (err, data) => {
                if (err) {
                    logger.log(`SourceMaps.loadSourceMapContents: Could not read sourcemap file - ` + err.message);
                    resolve(null);
                } else {
                    resolve(data);
                }
            });
        });
    }

    return contentsP;
}

function downloadSourceMapContents(sourceMapUri: string): Promise<string> {
    // use sha256 to ensure the hash value can be used in filenames
    // const hash = crypto.createHash('sha256').update(sourceMapUri).digest('hex');

    // const cachePath = path.join(os.tmpdir(), 'com.microsoft.VSCode', 'node-debug2', 'sm-cache');
    // const sourceMapPath = path.join(cachePath, hash);

    // const exists = utils.existsSync(sourceMapPath);
    // if (exists) {
    //     return loadSourceMapContents(sourceMapPath);
    // }

    return utils.getURL(sourceMapUri);
        // .then(responseText => {
        //     return utils.writeFileP(sourceMapPath, responseText)
        //         .then(() => responseText);
        // });
}
