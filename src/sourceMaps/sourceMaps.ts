/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { SourceMap, ISourcePathDetails } from './sourceMap';
import { SourceMapFactory } from './sourceMapFactory';
import { ISourceMapPathOverrides, IPathMapping } from '../debugAdapterInterfaces';
import { Position, LocationInLoadedSource, LocationInScript } from '../chrome/internal/locations/location';
import { createLineNumber, createColumnNumber } from '../chrome/internal/locations/subtypes';
import { parseResourceIdentifier, IResourceIdentifier, newResourceIdentifierMap } from '../chrome/internal/sources/resourceIdentifier';
import { CDTPScriptsRegistry } from '../chrome/cdtpDebuggee/registries/cdtpScriptsRegistry';
import { isNotNull } from '../chrome/utils/typedOperators';
import { SourceMapUrl } from './sourceMapUrl';

export class SourceMaps {
    // Maps absolute paths to generated/authored source files to their corresponding SourceMap object
    private _generatedPathToSourceMap = newResourceIdentifierMap<SourceMap>();
    private _authoredPathToSourceMap = newResourceIdentifierMap<SourceMap>();

    private _sourceMapFactory: SourceMapFactory;

    public constructor(private readonly _scriptsRegistry: CDTPScriptsRegistry, pathMapping?: IPathMapping, sourceMapPathOverrides?: ISourceMapPathOverrides, enableSourceMapCaching?: boolean) {
        this._sourceMapFactory = new SourceMapFactory(pathMapping, sourceMapPathOverrides, enableSourceMapCaching);
    }

    /**
     * Returns the generated script path for an authored source path
     * @param pathToSource - The absolute path to the authored file
     */
    public getGeneratedPathFromAuthoredPath(authoredPath: IResourceIdentifier): IResourceIdentifier | null {
        return this._authoredPathToSourceMap.has(authoredPath) ?
            this._authoredPathToSourceMap.get(authoredPath)!.generatedPath :
            null;
    }

    public getSourceMapFromAuthoredPath(authoredPath: IResourceIdentifier): SourceMap | null {
        return this._authoredPathToSourceMap.has(authoredPath) ?
            this._authoredPathToSourceMap.get(authoredPath) :
            null;
    }

    public tryGettingSourceMapFromGeneratedPath(pathToGenerated: string): SourceMap | undefined {
        return this._generatedPathToSourceMap.tryGetting(parseResourceIdentifier(pathToGenerated));
    }

    public mapToAuthored(pathToGenerated: string, line: number, column: number): LocationInLoadedSource | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this.tryGettingSourceMapFromGeneratedPath(pathToGenerated);
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
        const sourceMap = this.tryGettingSourceMapFromGeneratedPath(pathToGenerated);
        return sourceMap !== undefined ?
            sourceMap.mappedSources :
            null;
    }

    public allSourcePathDetails(pathToGenerated: string): ISourcePathDetails[] | null {
        pathToGenerated = pathToGenerated.toLowerCase();
        const sourceMap = this.tryGettingSourceMapFromGeneratedPath(pathToGenerated);
        return sourceMap !== undefined ?
            sourceMap.allSourcePathDetails :
            null;
    }

    /**
     * Given a new path to a new script file, finds and loads the sourcemap for that file
     */
    public async processNewSourceMap(pathToGenerated: string, sourceMapURL: SourceMapUrl, isVSClient = false): Promise<SourceMap | null> {
        const pathToGeneratedIdentifier = parseResourceIdentifier(pathToGenerated);
        const maybeSourceMap = this._generatedPathToSourceMap.tryGetting(pathToGeneratedIdentifier);

        // If we use the eager source map reader processNewSourceMap will get twice for the same script, once from the eager reader, and
        // once for script parsed
        if (maybeSourceMap === undefined) {
            const sourceMap = await this._sourceMapFactory.getMapForGeneratedPath(pathToGenerated, sourceMapURL, isVSClient);
            if (isNotNull(sourceMap)) {
                this._generatedPathToSourceMap.set(pathToGeneratedIdentifier, sourceMap);
                sourceMap.mappedSources.forEach(authoredSource => this._authoredPathToSourceMap.setAndReplaceIfExists(authoredSource, sourceMap));
                return sourceMap;
            } else {
                return null;
            }
        } else {
            return maybeSourceMap;
        }
    }
}
