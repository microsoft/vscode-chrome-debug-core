/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { SourceMap, ISourcePathDetails } from './sourceMap';
import { SourceMapFactory } from './sourceMapFactory';
import { ISourceMapPathOverrides, IPathMapping } from '../debugAdapterInterfaces';
import { Position, LocationInLoadedSource, LocationInScript } from '../chrome/internal/locations/location';
import { createLineNumber, createColumnNumber } from '../chrome/internal/locations/subtypes';
import { parseResourceIdentifier, IResourceIdentifier } from '../chrome/internal/sources/resourceIdentifier';
import { CDTPScriptsRegistry } from '../chrome/cdtpDebuggee/registries/cdtpScriptsRegistry';
import { isNotNull } from '../chrome/utils/typedOperators';

export class SourceMaps {
    // Maps absolute paths to generated/authored source files to their corresponding SourceMap object
    private _generatedPathToSourceMap = new Map<string, SourceMap>();
    private _authoredPathToSourceMap = new Map<string, SourceMap>();

    private _sourceMapFactory: SourceMapFactory;

    public constructor(private readonly _scriptsRegistry: CDTPScriptsRegistry, pathMapping?: IPathMapping, sourceMapPathOverrides?: ISourceMapPathOverrides, enableSourceMapCaching?: boolean) {
        this._sourceMapFactory = new SourceMapFactory(pathMapping, sourceMapPathOverrides, enableSourceMapCaching);
    }

    /**
     * Returns the generated script path for an authored source path
     * @param pathToSource - The absolute path to the authored file
     */
    public getGeneratedPathFromAuthoredPath(authoredPath: string): string | null {
        authoredPath = authoredPath.toLowerCase();
        return this._authoredPathToSourceMap.has(authoredPath) ?
            this._authoredPathToSourceMap.get(authoredPath)!.generatedPath() :
            null;
    }

    public mapToAuthored(pathToGenerated: string, line: number, column: number): LocationInLoadedSource | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this._generatedPathToSourceMap.get(pathToGenerated);
        const scripts = this._scriptsRegistry.getScriptsByPath(parseResourceIdentifier(pathToGenerated));
        if (scripts.length > 0) {
            const location = new LocationInScript(scripts[0], new Position(createLineNumber(line), createColumnNumber(column)));
            return sourceMap !== undefined
                ? sourceMap.authoredPosition(location, position => position, () => null)
                : null;
        } else {
            return null;
        }
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
        if (isNotNull(sourceMap)) {
            this._generatedPathToSourceMap.set(pathToGenerated.toLowerCase(), sourceMap);
            return sourceMap;
        } else {
            return null;
        }
    }
}
