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

    public mapToAuthored(pathToGenerated: string, line: number, column: number): MappedPosition | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated);
        return sourceMap !== undefined ?
            sourceMap.authoredPositionFor(line, column) :
            null;
    }

    public allMappedSources(pathToGenerated: string): string[] | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated);
        return sourceMap !== undefined ?
            sourceMap.authoredSources :
            null;
    }

    public allSourcePathDetails(pathToGenerated: string): ISourcePathDetails[] | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated);
        return sourceMap !== undefined ?
            sourceMap.allSourcePathDetails :
            null;
    }

    /**
     * Given a new path to a new script file, finds and loads the sourcemap for that file
     */
    public async processNewSourceMap(pathToGenerated: string, sourceMapURL: string, isVSClient = false): Promise<SourceMap | null> {
        const sourceMap = await this._sourceMapFactory.getMapForGeneratedPath(pathToGenerated, sourceMapURL, isVSClient);
        if (sourceMap) {
            this._generatedPathToSourceMap.set(pathToGenerated.toLowerCase(), sourceMap);
            sourceMap.authoredSources.forEach(authoredSource => this._authoredPathToSourceMap.set(authoredSource.toLowerCase(), sourceMap));
            return sourceMap;
        } else {
            return null;
        }
    }
}
