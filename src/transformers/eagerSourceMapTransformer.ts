/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';

import { BaseSourceMapTransformer } from './baseSourceMapTransformer';

import { ILaunchRequestArgs, IAttachRequestArgs } from '../debugAdapterInterfaces';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';

/**
 * Load SourceMaps on launch. Requires reading the file and parsing out the sourceMappingURL, because
 * if you wait until the script is loaded as in LazySMT, you get that info from the runtime.
 */
export class EagerSourceMapTransformer extends BaseSourceMapTransformer {
    private static SOURCE_MAPPING_MATCHER = new RegExp('^//[#@] ?sourceMappingURL=(.+)$');

    protected init(args: ILaunchRequestArgs | IAttachRequestArgs): void {
        super.init(args);
        if (args.sourceMaps) {
            const generatedCodeGlobs = args.outFiles ?
                args.outFiles :
                args.outDir ?
                    [path.join(args.outDir, '**/*.js')] :
                    [];

            // try to find all source files upfront asynchronously
            if (generatedCodeGlobs.length > 0) {
                logger.log('SourceMaps: preloading sourcemaps for scripts in globs: ' + JSON.stringify(generatedCodeGlobs));
                this._preLoad = utils.multiGlob(generatedCodeGlobs)
                    .then(paths => {
                        logger.log(`SourceMaps: expanded globs and found ${paths.length} scripts`);
                        return Promise.all(paths.map(scriptPath => this.discoverSourceMapForGeneratedScript(scriptPath)));
                    })
                    .then(() => { });
            } else {
                this._preLoad = Promise.resolve();
            }
        }
    }

    private discoverSourceMapForGeneratedScript(generatedScriptPath: string): Promise<void> {
        return this.findSourceMapUrlInFile(generatedScriptPath)
            .then(uri => {
                if (uri) {
                    logger.log(`SourceMaps: sourcemap url parsed from end of generated content: ${uri}`);
                    return this._sourceMaps.processNewSourceMap(generatedScriptPath, uri, this._isVSClient);
                } else {
                    logger.log(`SourceMaps: no sourcemap url found in generated script: ${generatedScriptPath}`);
                    return undefined;
                }
            })
            .catch(err => {
                // If we fail to preload one, ignore and keep going
                logger.log(`SourceMaps: could not preload for generated script: ${generatedScriptPath}. Error: ${err.toString()}`);
            });
    }

    /**
     * Try to find the 'sourceMappingURL' in content or the file with the given path.
     * Returns null if no source map url is found or if an error occured.
     */
    private findSourceMapUrlInFile(pathToGenerated: string, content?: string): Promise<string> {
        if (content) {
            return Promise.resolve(this.findSourceMapUrl(content));
        }

        return utils.readFileP(pathToGenerated)
            .then(fileContents => this.findSourceMapUrl(fileContents));
    }

    /**
     * Try to find the 'sourceMappingURL' at the end of the given contents.
     * Relative file paths are converted into absolute paths.
     * Returns null if no source map url is found.
     */
    private findSourceMapUrl(contents: string): string {
        const lines = contents.split('\n');
        for (let l = lines.length - 1; l >= Math.max(lines.length - 10, 0); l--) {    // only search for url in the last 10 lines
            const line = lines[l].trim();
            const matches = EagerSourceMapTransformer.SOURCE_MAPPING_MATCHER.exec(line);
            if (matches && matches.length === 2) {
                return matches[1].trim();
            }
        }

        return null;
    }
}
