/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { SourceMap, MappedPosition, ISourcePathDetails } from './sourceMap';
import { SourceMapFactory } from './sourceMapFactory';
import { ISourceMapPathOverrides, IPathMapping } from '../debugAdapterInterfaces';

export class SourceMaps {
    // Maps absolute paths to generated/authored source files to their corresponding SourceMap object
    private _generatedPathToSourceMap = new Map<string, SourceMap>();
    private _authoredPathToSourceMap = new Map<string, SourceMap>();

    private _sourceMapFactory: SourceMapFactory;

    public constructor(pathMapping?: IPathMapping, sourceMapPathOverrides?: ISourceMapPathOverrides, enableSourceMapCaching?: boolean) {
        this._sourceMapFactory = new SourceMapFactory(pathMapping, sourceMapPathOverrides, enableSourceMapCaching);
    }

    /**
     * Returns the generated script path for an authored source path
     * @param pathToSource - The absolute path to the authored file
     */
    public getGeneratedPathFromAuthoredPath(authoredPath: string): string {
        authoredPath = authoredPath.toLowerCase();
        return this._authoredPathToSourceMap.has(authoredPath) ?
            this._authoredPathToSourceMap.get(authoredPath).generatedPath() :
            null;
    }

    public mapToGenerated(authoredPath: string, line: number, column: number): MappedPosition {
        authoredPath = authoredPath.toLowerCase();
        return this._authoredPathToSourceMap.has(authoredPath) ?
            this._authoredPathToSourceMap.get(authoredPath)
                .generatedPositionFor(authoredPath, line, column) :
            null;
    }

    public mapToAuthored(pathToGenerated: string, line: number, column: number): MappedPosition {
        pathToGenerated = pathToGenerated.toLowerCase();
        return this._generatedPathToSourceMap.has(pathToGenerated) ?
            this._generatedPathToSourceMap.get(pathToGenerated)
                .authoredPositionFor(line, column) :
            null;
    }

    public allMappedSources(pathToGenerated: string): string[] {
        pathToGenerated = pathToGenerated.toLowerCase();
        return this._generatedPathToSourceMap.has(pathToGenerated) ?
            this._generatedPathToSourceMap.get(pathToGenerated).authoredSources :
            null;
    }

    public allSourcePathDetails(pathToGenerated: string): ISourcePathDetails[] {
        pathToGenerated = pathToGenerated.toLowerCase();
        return this._generatedPathToSourceMap.has(pathToGenerated) ?
            this._generatedPathToSourceMap.get(pathToGenerated).allSourcePathDetails :
            null;
    }

    public sourceContentFor(authoredPath: string): string {
        authoredPath = authoredPath.toLowerCase();
        return this._authoredPathToSourceMap.has(authoredPath) ?
            this._authoredPathToSourceMap.get(authoredPath)
                .sourceContentFor(authoredPath) :
            null;
    }

    /**
     * Given a new path to a new script file, finds and loads the sourcemap for that file
     */
    public async processNewSourceMap(pathToGenerated: string, originalUrlToGenerated: string | undefined, sourceMapURL: string, isVSClient = false): Promise<void> {
        const sourceMap = await this._sourceMapFactory.getMapForGeneratedPath(pathToGenerated, originalUrlToGenerated, sourceMapURL, isVSClient);
        if (sourceMap) {
            this._generatedPathToSourceMap.set(pathToGenerated.toLowerCase(), sourceMap);
            sourceMap.authoredSources.forEach(authoredSource => this._authoredPathToSourceMap.set(authoredSource.toLowerCase(), sourceMap));
        }
    }
}
