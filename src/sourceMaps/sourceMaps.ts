/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { SourceMap, ISourcePathDetails, IAuthoredPosition } from './sourceMap';
import { SourceMapFactory } from './sourceMapFactory';
import { ISourceMapPathOverrides, IPathMapping } from '../debugAdapterInterfaces';
import { IResourceIdentifier } from '..';

export class SourceMaps {
    // Maps absolute paths to generated/authored source files to their corresponding SourceMap object
    private _generatedPathToSourceMap = new Map<string, SourceMap>();

    private _sourceMapFactory: SourceMapFactory;

    public constructor(pathMapping?: IPathMapping, sourceMapPathOverrides?: ISourceMapPathOverrides, enableSourceMapCaching?: boolean) {
        this._sourceMapFactory = new SourceMapFactory(pathMapping, sourceMapPathOverrides, enableSourceMapCaching);
    }

    public mapToAuthored(pathToGenerated: string, line: number, column: number): IAuthoredPosition | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated);
        return sourceMap !== undefined
            ? sourceMap.authoredPosition(line, column, position => position, () => null)
            : null;
    }

    public allMappedSources(pathToGenerated: string): IResourceIdentifier[] | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated);
        return sourceMap !== undefined ?
            sourceMap.mappedSources :
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
            return sourceMap;
        } else {
            return null;
        }
    }
}
