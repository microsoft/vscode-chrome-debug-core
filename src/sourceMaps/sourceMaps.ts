/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {SourceMap, MappedPosition} from './sourceMap';
import {getMapForGeneratedPath} from './sourceMapFactory';
import {ISourceMapPathOverrides} from '../debugAdapterInterfaces';
import * as sourceMapUtils from './sourceMapUtils';
import {Maybe} from '../utils';

export class SourceMaps {
    // Maps absolute paths to generated/authored source files to their corresponding SourceMap object
    private _generatedPathToSourceMap = new Map<string, SourceMap>();
    private _authoredPathToSourceMap = new Map<string, SourceMap>();

    // Path to resolve / paths against
    private _webRoot?: string;

    private _sourceMapPathOverrides?: ISourceMapPathOverrides;

    public constructor(webRoot?: string, sourceMapPathOverrides?: ISourceMapPathOverrides) {
        this._webRoot = webRoot;
        if (sourceMapPathOverrides) {
            this._sourceMapPathOverrides = sourceMapUtils.resolveWebRootPattern(sourceMapPathOverrides, webRoot);
        }
    }

    /**
     * Returns the generated script path for an authored source path
     * @param pathToSource - The absolute path to the authored file
     */
    public getGeneratedPathFromAuthoredPath(authoredPath: string): Maybe<string> {
        const sourceMap = this._authoredPathToSourceMap.get(authoredPath.toLowerCase())
        return sourceMap && sourceMap.generatedPath();
    }

    public mapToGenerated(authoredPath: string, line: number, column: number): Maybe<MappedPosition> {
        const sourceMap = this._authoredPathToSourceMap.get(authoredPath.toLowerCase());
        return sourceMap && sourceMap.generatedPositionFor(authoredPath, line, column);
    }

    public mapToAuthored(pathToGenerated: string, line: number, column: number): Maybe<MappedPosition> {
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated.toLowerCase());
        return sourceMap && sourceMap.authoredPositionFor(line, column);
    }

    public allMappedSources(pathToGenerated: string): string[] {
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated.toLowerCase());
        return sourceMap ?
            sourceMap.authoredSources :
            [];
    }

    /**
     * Given a new path to a new script file, finds and loads the sourcemap for that file
     */
    public processNewSourceMap(pathToGenerated: string, sourceMapURL: string): Promise<void> {
        return this._generatedPathToSourceMap.has(pathToGenerated.toLowerCase()) ?
            Promise.resolve() :
            getMapForGeneratedPath(pathToGenerated, sourceMapURL, this._webRoot, this._sourceMapPathOverrides).then(sourceMap => {
                if (sourceMap) {
                    this._generatedPathToSourceMap.set(pathToGenerated.toLowerCase(), sourceMap);
                    sourceMap.authoredSources.forEach(authoredSource => this._authoredPathToSourceMap.set(authoredSource.toLowerCase(), sourceMap));
                }
            });
    }
}
