/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { SourceMapConsumer, MappedPosition as MappedPositionSM } from 'source-map';
import * as path from 'path';

import * as sourceMapUtils from './sourceMapUtils';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';
import { IPathMapping } from '../debugAdapterInterfaces';

export type MappedPosition = MappedPositionSM;

/**
 * A pair of the original path in the sourcemap, and the full absolute path as inferred
 */
export interface ISourcePathDetails {
    originalPath: string;
    inferredPath: string;
    startPosition: MappedPosition;
}

export class SourceMap {
    private _generatedPath: string; // the generated file for this sourcemap (absolute path)
    private _sources: string[]; // list of authored files (absolute paths)
    private _smc: SourceMapConsumer; // the source map
    private _authoredPathCaseMap = new Map<string, string>(); // Maintain pathCase map because VSCode is case sensitive

    private _allSourcePathDetails: ISourcePathDetails[]; // A list of all original paths from the sourcemap, and their inferred local paths

    // Original sourcemap details
    private _originalSources: string[];
    private _originalSourceRoot: string;

    /**
     * Returns list of ISourcePathDetails for all sources in this sourcemap, sorted by their
     * positions within the sourcemap.
     */
    public get allSourcePathDetails(): ISourcePathDetails[] {
        if (!this._allSourcePathDetails) {
            // Lazy compute because the source-map lib handles the bulk of the sourcemap parsing lazily, and this info
            // is not always needed.
            this._allSourcePathDetails = this._sources.map((inferredPath, i) => {
                const originalSource = this._originalSources[i];
                const originalPath = this._originalSourceRoot ? sourceMapUtils.getFullSourceEntry(this._originalSourceRoot, originalSource) : originalSource;
                return <ISourcePathDetails>{
                    inferredPath,
                    originalPath,
                    startPosition: this.generatedPositionFor(inferredPath, 0, 0)
                };
            }).sort((a, b) => {
                // https://github.com/Microsoft/vscode-chrome-debug/issues/353
                if (!a.startPosition) {
                    logger.log(`Could not map start position for: ${a.inferredPath}`);
                    return -1;
                } else if (!b.startPosition) {
                    logger.log(`Could not map start position for: ${b.inferredPath}`);
                    return 1;
                }

                if (a.startPosition.line === b.startPosition.line) {
                    return a.startPosition.column - b.startPosition.column;
                } else {
                    return a.startPosition.line - b.startPosition.line;
                }
            });
        }

        return this._allSourcePathDetails;
    }

    /**
     * generatedPath: an absolute local path or a URL
     * json: sourcemap contents as string
     */
    public constructor(generatedPath: string, json: string, pathMapping?: IPathMapping, sourceMapPathOverrides?: utils.IStringDictionary<string>, isVSClient = false) {
        this._generatedPath = generatedPath;

        const sm = JSON.parse(json);
        logger.log(`SourceMap: creating for ${generatedPath}`);
        logger.log(`SourceMap: sourceRoot: ${sm.sourceRoot}`);
        if (sm.sourceRoot && sm.sourceRoot.toLowerCase() === '/source/') {
            logger.log('Warning: if you are using gulp-sourcemaps < 2.0 directly or indirectly, you may need to set sourceRoot manually in your build config, if your files are not actually under a directory called /source');
        }
        logger.log(`SourceMap: sources: ${JSON.stringify(sm.sources)}`);
        if (pathMapping) {
            logger.log(`SourceMap: pathMapping: ${JSON.stringify(pathMapping)}`);
        }

        // Absolute path
        const computedSourceRoot = sourceMapUtils.getComputedSourceRoot(sm.sourceRoot, this._generatedPath, pathMapping);

        // Overwrite the sourcemap's sourceRoot with the version that's resolved to an absolute path,
        // so the work above only has to be done once
        this._originalSourceRoot = sm.sourceRoot;
        this._originalSources = sm.sources;
        sm.sourceRoot = null;

        // sm.sources are initially relative paths, file:/// urls, made-up urls like webpack:///./app.js, or paths that start with /.
        // resolve them to file:/// urls, using computedSourceRoot, to be simpler and unambiguous, since
        // it needs to look them up later in exactly the same format.
        this._sources = sm.sources.map(sourcePath => {
            if (sourceMapPathOverrides) {
                const fullSourceEntry = sourceMapUtils.getFullSourceEntry(this._originalSourceRoot, sourcePath);
                const mappedFullSourceEntry = sourceMapUtils.applySourceMapPathOverrides(fullSourceEntry, sourceMapPathOverrides, isVSClient);
                if (fullSourceEntry !== mappedFullSourceEntry) {
                    return utils.canonicalizeUrl(mappedFullSourceEntry);
                }
            }

            if (sourcePath.startsWith('file://')) {
                // strip file://
                return utils.canonicalizeUrl(sourcePath);
            }

            if (!path.isAbsolute(sourcePath)) {
                // Overrides not applied, use the computed sourceRoot
                sourcePath = utils.properResolve(computedSourceRoot, sourcePath);
            }

            return utils.canonicalizeUrl(sourcePath);
        });

        // Rewrite sm.sources to same as this._sources but file url with forward slashes
        sm.sources = this._sources.map(sourceAbsPath => {
            // Convert to file:/// url. After this, it's a file URL for an absolute path to a file on disk with forward slashes.
            // We lowercase so authored <-> generated mapping is not case sensitive.
            const lowerCaseSourceAbsPath = sourceAbsPath.toLowerCase();
            this._authoredPathCaseMap.set(lowerCaseSourceAbsPath, sourceAbsPath);
            return utils.pathToFileURL(lowerCaseSourceAbsPath, true);
        });

        this._smc = new SourceMapConsumer(sm);
    }

    /*
     * Return all mapped sources as absolute paths
     */
    public get authoredSources(): string[] {
        return this._sources;
    }

    /*
     * The generated file of this source map.
     */
    public generatedPath(): string {
        return this._generatedPath;
    }

    /*
     * Returns true if this source map originates from the given source.
     */
    public doesOriginateFrom(absPath: string): boolean {
        return this.authoredSources.some(path => path === absPath);
    }

    /*
     * Finds the nearest source location for the given location in the generated file.
     * Will return null instead of a mapping on the next line (different from generatedPositionFor).
     */
    public authoredPositionFor(line: number, column: number): MappedPosition {
        // source-map lib uses 1-indexed lines.
        line++;

        const lookupArgs = {
            line,
            column,
            bias: (<any>SourceMapConsumer).GREATEST_LOWER_BOUND
        };

        let position = this._smc.originalPositionFor(lookupArgs);
        if (!position.source) {
            // If it can't find a match, it returns a mapping with null props. Try looking the other direction.
            lookupArgs.bias = (<any>SourceMapConsumer).LEAST_UPPER_BOUND;
            position = this._smc.originalPositionFor(lookupArgs);
        }

        if (position.source) {
            // file:/// -> absolute path
            position.source = utils.canonicalizeUrl(position.source);

            // Convert back to original case
            position.source = this._authoredPathCaseMap.get(position.source) || position.source;

            // Back to 0-indexed lines
            position.line--;

            return position;
        } else {
            return null;
        }
    }

    /*
     * Finds the nearest location in the generated file for the given source location.
     * Will return a mapping on the next line, if there is no subsequent mapping on the expected line.
     */
    public generatedPositionFor(source: string, line: number, column: number): MappedPosition {
        // source-map lib uses 1-indexed lines.
        line++;

        // sources in the sourcemap have been forced to file:///
        // Convert to lowerCase so search is case insensitive
        source = utils.pathToFileURL(source.toLowerCase(), true);

        const lookupArgs = {
            line,
            column,
            source,
            bias: (<any>SourceMapConsumer).LEAST_UPPER_BOUND
        };

        let position = this._smc.generatedPositionFor(lookupArgs);
        if (position.line === null) {
            // If it can't find a match, it returns a mapping with null props. Try looking the other direction.
            lookupArgs.bias = (<any>SourceMapConsumer).GREATEST_LOWER_BOUND;
            position = this._smc.generatedPositionFor(lookupArgs);
        }

        if (position.line === null) {
            return null;
        } else {
            return {
                line: position.line - 1, // Back to 0-indexed lines
                column: position.column,
                source: this._generatedPath
            };
        }
    }

    public sourceContentFor(authoredSourcePath: string): string {
        authoredSourcePath = utils.pathToFileURL(authoredSourcePath, true);
        return (<any>this._smc).sourceContentFor(authoredSourcePath, /*returnNullOnMissing=*/true);
    }
}
