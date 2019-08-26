/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as url from 'url';
import * as _ from 'lodash';

import * as sourceMapUtils from './sourceMapUtils';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';
import { SourceMap } from './sourceMap';
import { ISourceMapPathOverrides, IPathMapping } from '../debugAdapterInterfaces';
import { isDefined, isNotNull, isNull, isTrue } from '../chrome/utils/typedOperators';
import { SourceMapUrl } from './sourceMapUrl';
import { SourceMapContents } from './sourceMapContents';

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
    getMapForGeneratedPath(pathToGenerated: string, mapPath: SourceMapUrl, isVSClient = false): Promise<SourceMap | null> {
        let msg = `SourceMaps.getMapForGeneratedPath: Finding SourceMap for ${pathToGenerated} by URI: ${mapPath}`;
        if (isDefined(this._pathMapping)) {
            msg += ` and webRoot/pathMapping: ${JSON.stringify(this._pathMapping)}`;
        }

        logger.log(msg);

        // For an inlined sourcemap, mapPath is a data URI containing a blob of base64 encoded data, starting
        // with a tag like "data:application/json;charset:utf-8;base64,". The data should start after the last comma.
        let sourceMapContentsP: Promise<SourceMapContents | null>;
        if (mapPath.isInlineSourceMap) {
            // Sourcemap is inlined
            logger.log(`SourceMaps.getMapForGeneratedPath: Using inlined sourcemap in ${pathToGenerated}`);
            sourceMapContentsP = Promise.resolve(mapPath.inlineSourceMapContents());
        } else {
            // The mapPath is not data:application/json so it can't have the sources content embedded
            sourceMapContentsP = this.getSourceMapContent(pathToGenerated, mapPath.customerContentData);
        }

        return sourceMapContentsP.then(async contents => {
            if (isNotNull(contents)) {
                try {
                    // Throws for invalid JSON
                    return await SourceMap.create(pathToGenerated, contents, this._pathMapping, this._sourceMapPathOverrides, isVSClient);
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
     * Resolves a sourcemap's path and loads the data
     */
    private getSourceMapContent(pathToGenerated: string, mapPathArg: string): Promise<SourceMapContents | null> {
        const mapPath = sourceMapUtils.resolveMapPath(pathToGenerated, mapPathArg, this._pathMapping);
        if (isNull(mapPath)) {
            return Promise.resolve(null);
        }

        return this.loadSourceMapContents(mapPath).then(contents => {
            if (isNull(contents)) {
                // Last ditch effort - just look for a .js.map next to the script
                const mapPathNextToSource = pathToGenerated + '.map';
                if (mapPathNextToSource !== mapPath) {
                    return this.loadSourceMapContents(mapPathNextToSource);
                }
            }

            return contents;
        });
    }

    private loadSourceMapContents(mapPathOrURL: string): Promise<SourceMapContents | null> {
        let contentsP: Promise<SourceMapContents | null>;
        if (utils.isURL(mapPathOrURL) && !utils.isFileUrl(mapPathOrURL)) {
            logger.log(`SourceMaps.loadSourceMapContents: Downloading sourcemap file from ${mapPathOrURL}`);
            contentsP = this.downloadSourceMapContents(mapPathOrURL).catch(_e => {
                logger.log(`SourceMaps.loadSourceMapContents: Could not download sourcemap from ${mapPathOrURL}`);
                return null;
            });
        } else {
            mapPathOrURL = utils.canonicalizeUrl(mapPathOrURL);
            contentsP = new Promise((resolve) => {
                logger.log(`SourceMaps.loadSourceMapContents: Reading local sourcemap file from ${mapPathOrURL}`);
                fs.readFile(mapPathOrURL, (err: NodeJS.ErrnoException | null, data?: Buffer) => {
                    if (isNotNull(err)) {
                        logger.log(`SourceMaps.loadSourceMapContents: Could not read sourcemap file - ` + err.message);
                        resolve(null);
                    } else {
                        resolve(isDefined(data) ? new SourceMapContents(data.toString()) : undefined);
                    }
                });
            });
        }

        return contentsP;
    }

    private async downloadSourceMapContents(sourceMapUri: string): Promise<SourceMapContents | null> {
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

    private async _downloadSourceMapContents(sourceMapUri: string): Promise<SourceMapContents | null> {
        // use sha256 to ensure the hash value can be used in filenames
        let cachedSourcemapPath: string | null = null;
        if (isTrue(this._enableSourceMapCaching)) {
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
        if (isNotNull(cachedSourcemapPath) && isTrue(this._enableSourceMapCaching)) {
            logger.log(`Sourcemaps.downloadSourceMapContents: Caching sourcemap file at ${cachedSourcemapPath}`);
            await utils.writeFileP(cachedSourcemapPath, responseText);
        }

        return new SourceMapContents(responseText);
    }
}
