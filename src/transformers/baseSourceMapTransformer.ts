/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';

import { ILaunchRequestArgs, IAttachRequestArgs, IScopesResponseBody } from '../debugAdapterInterfaces';
import { ISourcePathDetails, SourceMap } from '../sourceMaps/sourceMap';
import { SourceMaps } from '../sourceMaps/sourceMaps';
import { logger } from 'vscode-debugadapter';

import { ILoadedSource } from '../chrome/internal/sources/loadedSource';
import { TYPES } from '../chrome/dependencyInjection.ts/types';
import { inject, injectable } from 'inversify';
import { IConnectedCDAConfiguration } from '../chrome/client/chromeDebugAdapter/cdaConfiguration';
import { IResourceIdentifier } from '..';
import { LocationInLoadedSource } from '../chrome/internal/locations/location';
import { CDTPScriptsRegistry } from '../chrome/cdtpDebuggee/registries/cdtpScriptsRegistry';
import { isTrue, isDefined, isEmpty, isNotNull, isNull, isUndefined, isNotEmpty } from '../chrome/utils/typedOperators';
import * as _ from 'lodash';

export interface ISourceLocation {
    source: ILoadedSource;
    line: number;
    column: number;
    isSourceMapped?: boolean; // compat with stack frame
}

/**
 * If sourcemaps are enabled, converts from source files on the client side to runtime files on the target side
 */
@injectable()
export class BaseSourceMapTransformer {
    protected _sourceMaps: SourceMaps | undefined = undefined;
    private _enableSourceMapCaching: boolean;

    private _allRuntimeScriptPaths = new Set<string>();

    protected _preLoad = Promise.resolve();
    private _processingNewSourceMap: Promise<any> = Promise.resolve();

    public caseSensitivePaths = false;

    protected _isVSClient = false;

    constructor(
        @inject(TYPES.ConnectedCDAConfiguration) configuration: IConnectedCDAConfiguration,
        private readonly _scriptsRegistry: CDTPScriptsRegistry) {
        this._enableSourceMapCaching = isTrue(configuration.args.enableSourceMapCaching);
        this.init(configuration.args);
        this.isVSClient = configuration.clientCapabilities.clientID === 'visualstudio';
    }

    public set isVSClient(newValue: boolean) {
        this._isVSClient = newValue;
    }

    protected init(args: ILaunchRequestArgs | IAttachRequestArgs): void {
        // Enable sourcemaps and async callstacks by default
        const areSourceMapsEnabled = typeof args.sourceMaps === 'undefined' || args.sourceMaps;
        if (areSourceMapsEnabled) {
            this._enableSourceMapCaching = isTrue(args.enableSourceMapCaching);
            this._sourceMaps = new SourceMaps(this._scriptsRegistry, args.pathMapping, args.sourceMapPathOverrides, this._enableSourceMapCaching);
            this._allRuntimeScriptPaths = new Set<string>();
        }
    }

    public clearTargetContext(): void {
        this._allRuntimeScriptPaths = new Set<string>();
    }

    public async scriptParsed(pathToGenerated: string, sourceMapURL: string | undefined): Promise<SourceMap | null> {
        if (isDefined(this._sourceMaps)) {
            this._allRuntimeScriptPaths.add(this.fixPathCasing(pathToGenerated));

            if (isEmpty(sourceMapURL)) return null;

            // Load the sourcemap for this new script and log its sources
            const processNewSourceMapP = this._sourceMaps.processNewSourceMap(pathToGenerated, sourceMapURL, this._isVSClient);
            this._processingNewSourceMap = Promise.all([this._processingNewSourceMap, processNewSourceMapP]);
            await processNewSourceMapP;

            const sources = this._sourceMaps.allMappedSources(pathToGenerated);
            if (isNotNull(sources)) {
                logger.log(`SourceMaps.scriptParsed: ${pathToGenerated} was just loaded and has mapped sources: ${JSON.stringify(sources) }`);
            } else {
                logger.log(`No SourceMaps.scriptParsed: ${pathToGenerated} was just loaded and doesn't have any mapped sources at url: ${sourceMapURL}`);
            }

            return processNewSourceMapP;
        } else {
            return null;
        }
    }

    public scopesResponse(pathToGenerated: string, scopesResponse: IScopesResponseBody): void {
        if (isDefined(this._sourceMaps)) {
            scopesResponse.scopes.forEach(scope => this.mapScopeLocations(pathToGenerated, scope));
        }
    }

    private mapScopeLocations(pathToGenerated: string, scope: DebugProtocol.Scope): void {
        // The runtime can return invalid scope locations. Just skip those scopes. https://github.com/Microsoft/vscode-chrome-debug-core/issues/333
        if (typeof scope.line !== 'number' || typeof scope.column !== 'number' || typeof scope.endLine !== 'number' || typeof scope.endColumn !== 'number'
            || scope.line < 0 || scope.endLine < 0 || scope.column < 0 || scope.endColumn < 0) {
            return;
        }

        let mappedStart = this._sourceMaps!.mapToAuthored(pathToGenerated, scope.line, scope.column);
        let shiftedScopeStartForward = false;

        // If the scope is an async function, then the function declaration line may be missing a source mapping.
        // So if we failed, try to get the next line.
        if (isNull(mappedStart)) {
            mappedStart = this._sourceMaps!.mapToAuthored(pathToGenerated, scope.line + 1, scope.column);
            shiftedScopeStartForward = true;
        }

        if (isNotNull(mappedStart)) {
            // Only apply changes if both mappings are found
            const mappedEnd = this._sourceMaps!.mapToAuthored(pathToGenerated, scope.endLine, scope.endColumn);
            if (isNotNull(mappedEnd)) {
                scope.line = mappedStart.position.lineNumber;
                if (shiftedScopeStartForward) {
                    scope.line--;
                }
                scope.column = mappedStart.position.columnNumber;

                scope.endLine = mappedEnd.position.lineNumber;
                scope.endColumn = mappedEnd.position.columnNumber;
            }
        }
    }

    public async mapToAuthored(pathToGenerated: string, line: number, column: number): Promise<LocationInLoadedSource | null> {
        if (isUndefined(this._sourceMaps)) return null;

        await this.wait();
        return this._sourceMaps.mapToAuthored(pathToGenerated, line, column);
    }

    public async getGeneratedPathFromAuthoredPath(authoredPath: string): Promise<string | null> {
        if (!this._sourceMaps) return authoredPath;

        await this.wait();

        // Find the generated path, or check whether this script is actually a runtime path - if so, return that
        return this._sourceMaps.getGeneratedPathFromAuthoredPath(authoredPath) ||
            (this.isRuntimeScript(authoredPath) ? authoredPath : null);
    }

    private isRuntimeScript(scriptPath: string): boolean {
        return this._allRuntimeScriptPaths.has(this.fixPathCasing(scriptPath));
    }

    public async allSources(pathToGenerated: string): Promise<IResourceIdentifier[]> {
        if (isUndefined(this._sourceMaps)) return [];

        await this.wait();
        return _.defaultTo(this._sourceMaps.allMappedSources(pathToGenerated), []);
    }

    public async allSourcePathDetails(pathToGenerated: string): Promise<ISourcePathDetails[]> {
        if (isUndefined(this._sourceMaps)) return [];

        await this.wait();
        return _.defaultTo(this._sourceMaps.allSourcePathDetails(pathToGenerated), []);
    }

    private wait(): Promise<any> {
        return Promise.all([this._preLoad, this._processingNewSourceMap]);
    }

    private fixPathCasing(str: string): string {
        return isNotEmpty(str) && !this.caseSensitivePaths ? str.toLowerCase() : str;
    }
}
