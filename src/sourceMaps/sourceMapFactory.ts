/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as url from 'url';

import * as sourceMapUtils from './sourceMapUtils';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';
import { SourceMap } from './sourceMap';
import { ISourceMapPathOverrides, IPathMapping } from '../debugAdapterInterfaces';
import { isInternalRemotePath } from '../remoteMapper';

export class SourceMapFactory {
    constructor(
        private _pathMapping?: IPathMapping,
        private _sourceMapPathOverrides?: ISourceMapPathOverrides,
        private _enableSourceMapCaching?: boolean) {
    }

    /**
     * pathToGenerated - an absolute local path or a URL.
     * mapPath - a path relative to pathToGenerated.
     */
    getMapForGeneratedPath(pathToGenerated: string, originalUrlToGenerated: string | undefined, mapPath: string, isVSClient = false): Promise<SourceMap> {
        let msg = `SourceMaps.getMapForGeneratedPath: Finding SourceMap for ${pathToGenerated} by URI: ${mapPath}`;
        if (this._pathMapping) {
            msg += ` and webRoot/pathMapping: ${JSON.stringify(this._pathMapping)}`;
        }

        logger.log(msg);

        // For an inlined sourcemap, mapPath is a data URI containing a blob of base64 encoded data, starting
        // with a tag like "data:application/json;charset:utf-8;base64,". The data should start after the last comma.
        let sourceMapContentsP: Promise<string>;
        if (mapPath.indexOf('data:application/json') >= 0) {
            // Sourcemap is inlined
            logger.log(`SourceMaps.getMapForGeneratedPath: Using inlined sourcemap in ${pathToGenerated}`);
            sourceMapContentsP = Promise.resolve(this.getInlineSourceMapContents(mapPath));
        } else {
            const accessPath = isInternalRemotePath(pathToGenerated) && originalUrlToGenerated ?
                originalUrlToGenerated :
                pathToGenerated;
            sourceMapContentsP = this.getSourceMapContent(accessPath, mapPath);
        }

        return sourceMapContentsP.then(contents => {
            if (contents) {
                try {
                    // Throws for invalid JSON
                    return new SourceMap(pathToGenerated, contents, this._pathMapping, this._sourceMapPathOverrides, isVSClient);
                } catch (e) {
                    logger.error(`SourceMaps.getMapForGeneratedPath: exception while processing path: ${pathToGenerated}, sourcemap: ${mapPath}\n${e.stack}`);
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
    private getInlineSourceMapContents(sourceMapData: string): string {
        const firstCommaPos = sourceMapData.indexOf(',');
        if (firstCommaPos < 0) {
            logger.log(`SourceMaps.getInlineSourceMapContents: Inline sourcemap is malformed. Starts with: ${sourceMapData.substr(0, 200)}`);
            return null;
        }
        const header = sourceMapData.substr(0, firstCommaPos);
        const data = sourceMapData.substr(firstCommaPos + 1);

        try {
            if (header.indexOf(';base64') !== -1) {
                const buffer = Buffer.from(data, 'base64');
                return buffer.toString();
            } else {
                // URI encoded.
                return decodeURI(data);
            }
        } catch (e) {
            logger.error(`SourceMaps.getInlineSourceMapContents: exception while processing data uri (${e.stack})`);
        }

        return null;
    }

    /**
     * Resolves a sourcemap's path and loads the data
     */
    private getSourceMapContent(pathToGenerated: string, mapPath: string): Promise<string> {
        mapPath = sourceMapUtils.resolveMapPath(pathToGenerated, mapPath, this._pathMapping);
        if (!mapPath) {
            return Promise.resolve(null);
        }

        return this.loadSourceMapContents(mapPath).then(contents => {
            if (!contents) {
                // Last ditch effort - just look for a .js.map next to the script
                const mapPathNextToSource = pathToGenerated + '.map';
                if (mapPathNextToSource !== mapPath) {
                    return this.loadSourceMapContents(mapPathNextToSource);
                }
            }

            return contents;
        });
    }

    private loadSourceMapContents(mapPathOrURL: string): Promise<string> {
        let contentsP: Promise<string>;
        if (utils.isURL(mapPathOrURL) && !utils.isFileUrl(mapPathOrURL)) {
            logger.log(`SourceMaps.loadSourceMapContents: Downloading sourcemap file from ${mapPathOrURL}`);
            contentsP = this.downloadSourceMapContents(mapPathOrURL).catch(e => {
                logger.log(`SourceMaps.loadSourceMapContents: Could not download sourcemap from ${mapPathOrURL}`);
                return null;
            });
        } else {
            mapPathOrURL = utils.canonicalizeUrl(mapPathOrURL);
            contentsP = new Promise((resolve, reject) => {
                logger.log(`SourceMaps.loadSourceMapContents: Reading local sourcemap file from ${mapPathOrURL}`);
                fs.readFile(mapPathOrURL, (err, data) => {
                    if (err) {
                        logger.log(`SourceMaps.loadSourceMapContents: Could not read sourcemap file - ` + err.message);
                        resolve(null);
                    } else {
                        resolve(data && data.toString());
                    }
                });
            });
        }

        return contentsP;
    }

    private async downloadSourceMapContents(sourceMapUri: string): Promise<string> {
        try {
            return await this._downloadSourceMapContents(sourceMapUri);
        } catch (e) {
            if (url.parse(sourceMapUri).hostname === 'localhost') {
                logger.log(`Sourcemaps.downloadSourceMapContents: downlading from 127.0.0.1 instead of localhost`);
                return this._downloadSourceMapContents(sourceMapUri.replace('localhost', '127.0.0.1'));
            }

            throw e;
        }
    }

    private async _downloadSourceMapContents(sourceMapUri: string): Promise<string> {
        // use sha256 to ensure the hash value can be used in filenames
        let cachedSourcemapPath: string;
        if (this._enableSourceMapCaching) {
            const hash = crypto.createHash('sha256').update(sourceMapUri).digest('hex');

            const cachePath = path.join(os.tmpdir(), 'com.microsoft.VSCode', 'node-debug2', 'sm-cache');
            cachedSourcemapPath = path.join(cachePath, hash);

            const exists = utils.existsSync(cachedSourcemapPath);
            if (exists) {
                logger.log(`Sourcemaps.downloadSourceMapContents: Reading cached sourcemap file from ${cachedSourcemapPath}`);
                return this.loadSourceMapContents(cachedSourcemapPath);
            }
        }

        const responseText = await utils.getURL(sourceMapUri);
        if (cachedSourcemapPath && this._enableSourceMapCaching) {
            logger.log(`Sourcemaps.downloadSourceMapContents: Caching sourcemap file at ${cachedSourcemapPath}`);
            await utils.writeFileP(cachedSourcemapPath, responseText);
        }

        return responseText;
    }
}
