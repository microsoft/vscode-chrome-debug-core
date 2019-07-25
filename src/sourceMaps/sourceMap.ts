/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { SourceMapConsumer, MappedPosition, NullablePosition, RawSourceMap } from 'source-map';
import * as path from 'path';

import * as sourceMapUtils from './sourceMapUtils';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';
import { IPathMapping } from '../debugAdapterInterfaces';
import { Position, LocationInLoadedSource, LocationInScript, LocationInSource } from '../chrome/internal/locations/location';
import { createLineNumber, createColumnNumber, LineNumber, ColumnNumber } from '../chrome/internal/locations/subtypes';
import { newResourceIdentifierMap, IResourceIdentifier, parseResourceIdentifier, parseResourceIdentifiers, newResourceIdentifierSet, LocalFileURL } from '../chrome/internal/sources/resourceIdentifier';
import * as _ from 'lodash';
import { IValidatedMap } from '../chrome/collections/validatedMap';
import { Range } from '../chrome/internal/locations/rangeInScript';
import { SetUsingProjection } from '../chrome/collections/setUsingProjection';
import { isNotEmpty, isDefined, isNull } from '../chrome/utils/typedOperators';
import { wrapWithMethodLogger } from '../chrome/logging/methodsCalledLogger';

export type MappedPosition = MappedPosition;

/**
 * A pair of the original path in the sourcemap, and the full absolute path as inferred
 */
export interface ISourcePathDetails {
    originalPath: IResourceIdentifier;
    inferredPath: IResourceIdentifier;
    startPosition: IGeneratedPosition | null;
}

export interface NonNullablePosition extends NullablePosition {
    line: number;
    column: number;
    lastColumn: number | null;
}

export interface IGeneratedPosition {
    source: IResourceIdentifier;
    line: LineNumber;
    column: ColumnNumber;
}

class SourcePathMappingCalculator {
    public constructor(private _sourceMap: SourceMap, private _originalSourceRoot: string | undefined,
        private _originalSourcesInOrder: string[], private readonly _normalizedSourcesInOrder: IResourceIdentifier[]) { }

    /**
     * Returns list of ISourcePathDetails for all sources in this sourcemap, sorted by their
     * positions within the sourcemap.
     */
    public get allSourcePathDetails(): ISourcePathDetails[] {
        // Lazy compute because the source-map lib handles the bulk of the sourcemap parsing lazily, and this info
        // is not always needed.
        return this._normalizedSourcesInOrder.map((inferredPath: IResourceIdentifier, i: number) => {
            const originalSource = this._originalSourcesInOrder[i];
            const originalPath = isNotEmpty(this._originalSourceRoot)
                ? sourceMapUtils.getFullSourceEntry(this._originalSourceRoot, originalSource)
                : originalSource;

            let startPosition;
            try {
                startPosition = this._sourceMap.generatedPositionFor(inferredPath, 0, 0);
            } catch {
                startPosition = null;
            }
            return <ISourcePathDetails>{
                inferredPath,
                originalPath,
                startPosition: startPosition
            };
        }).sort((a, b) => {
            // https://github.com/Microsoft/vscode-chrome-debug/issues/353
            if (isNull(a.startPosition)) {
                logger.log(`Could not map start position for: ${a.inferredPath}`);
                return -1;
            } else if (isNull(b.startPosition)) {
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
}

export class SourceMap {
    private readonly _sourcePathMappingCalculator: SourcePathMappingCalculator;

    public constructor(
        private readonly _generatedPath: string,
        sourceMap: RawSourceMap,
        normalizedSourcesInOrder: IResourceIdentifier[],
        private readonly _sources: SetUsingProjection<IResourceIdentifier, string>, // list of authored files (absolute paths)
        private readonly _smc: SourceMapConsumer // the source map
    ) {
        this._sourcePathMappingCalculator = new SourcePathMappingCalculator(this, sourceMap.sourceRoot, sourceMap.sources, normalizedSourcesInOrder);
    }

    /**
     * generatedPath: an absolute local path or a URL
     * json: sourcemap contents as string
     */
    public static async create(generatedPath: string, json: string, pathMapping?: IPathMapping,
        sourceMapPathOverrides?: utils.IStringDictionary<string>, isVSClient = false): Promise<SourceMap> {
        const sourceMap: RawSourceMap = JSON.parse(json);
        logger.log(`SourceMap: creating for ${generatedPath}`);
        logger.log(`SourceMap: sourceRoot: ${sourceMap.sourceRoot}`);
        if (isNotEmpty(sourceMap.sourceRoot) && sourceMap.sourceRoot.toLowerCase() === '/source/') {
            logger.log('Warning: if you are using gulp-sourcemaps < 2.0 directly or indirectly, you may need to set sourceRoot manually in your build config, if your files are not actually under a directory called /source');
        }
        logger.log(`SourceMap: sources: ${JSON.stringify(sourceMap.sources)}`);
        if (isDefined(pathMapping)) {
            logger.log(`SourceMap: pathMapping: ${JSON.stringify(pathMapping)}`);
        }

        // Absolute path
        const computedSourceRoot = sourceMapUtils.getComputedSourceRoot(sourceMap.sourceRoot, generatedPath, pathMapping);

        // sourceMap.sources are initially relative paths, file:/// urls, made-up urls like webpack:///./app.js, or paths that start with /.
        // resolve them to file:/// urls, using computedSourceRoot, to be simpler and unambiguous, since
        // it needs to look them up later in exactly the same format.
        const normalizedSources = sourceMap.sources.map(sourcePath => {
            if (isDefined(sourceMapPathOverrides)) {
                const fullSourceEntry = sourceMapUtils.getFullSourceEntry(sourceMap.sourceRoot, sourcePath);
                const mappedFullSourceEntry = sourceMapUtils.applySourceMapPathOverrides(fullSourceEntry.textRepresentation, sourceMapPathOverrides, isVSClient);
                if (fullSourceEntry.textRepresentation !== mappedFullSourceEntry) {
                    return mappedFullSourceEntry; // If we found a path override that applies, return the result of applying it
                }
            }

            if (sourcePath.startsWith('file://')) {
                // strip file://
                return new LocalFileURL(sourcePath).filePathRepresentation;
            }

            if (!path.isAbsolute(sourcePath)) {
                // Overrides not applied, use the computed sourceRoot
                return path.resolve(computedSourceRoot, sourcePath);
            } else {
                return sourcePath;
            }
        });

        const identifiers = parseResourceIdentifiers(normalizedSources);
        const setOfNormalizedSources = newResourceIdentifierSet(identifiers);

        const normalizedSourceMap = Object.assign({}, sourceMap,
            {
                sources: identifiers.map(i => i.canonicalized), // We replace all sources with canonicalized absolute paths
                sourceRoot: undefined // Given that we are putting absolute paths in sources, we remove the sourceRoot to avoid applying the prefix a second time
            });

        const consumer = await new SourceMapConsumer(normalizedSourceMap);
        const consumerWithLogging = wrapWithMethodLogger(consumer, `SourceMap: ${path.basename(generatedPath)}`);
        consumer.computeColumnSpans(); // So allGeneratedPositionsFor will return the last column info
        return new SourceMap(generatedPath, sourceMap, parseResourceIdentifiers(consumer.sources), setOfNormalizedSources, consumerWithLogging);
    }

    public get generatedPath(): IResourceIdentifier {
        return parseResourceIdentifier(this._generatedPath);
    }

    /**
     * Returns list of ISourcePathDetails for all sources in this sourcemap, sorted by their
     * positions within the sourcemap.
     */
    public get allSourcePathDetails(): ISourcePathDetails[] {
        return this._sourcePathMappingCalculator.allSourcePathDetails;
    }

    /*
     * Return all mapped sources as absolute paths
     */
    public get mappedSources(): IResourceIdentifier[] {
        return Array.from(this._sources.keys());
    }

    /*
     * Finds the nearest source location for the given location in the generated file.
     * Will return null instead of a mapping on the next line (different from generatedPositionFor).
     */
    public authoredPosition<T>(position: LocationInScript, whenMappedAction: (position: LocationInLoadedSource) => T, noMappingAction: () => T): T {
        const lookupArgs = {
            line: position.position.lineNumber + 1, // source-map lib uses 1-indexed lines.
            column: position.position.columnNumber
        };

        const authoredPosition = this.tryInBothDirections(lookupArgs, args => this._smc.originalPositionFor(args));

        if (typeof authoredPosition.source === 'string' && typeof authoredPosition.line === 'number' && typeof authoredPosition.column === 'number') {
            const source = this._sources.get(parseResourceIdentifier(authoredPosition.source));
            return whenMappedAction(
                new LocationInLoadedSource(position.script.getSource(source), new Position(
                    createLineNumber(authoredPosition.line - 1), // Back to 0-indexed lines
                    createColumnNumber(authoredPosition.column))));
        } else {
            return noMappingAction();
        }
    }

    /*
     * Finds the nearest location in the generated file for the given source location.
     * Will return a mapping on the next line, if there is no subsequent mapping on the expected line.
     */
    public generatedPositionFor(source: IResourceIdentifier, line: number, column: number): IGeneratedPosition {
        const lookupArgs = {
            line: line + 1, // source-map lib uses 1-indexed lines.
            column,
            source: source.canonicalized
        };

        const position = this.tryInBothDirections(lookupArgs, args => this._smc.generatedPositionFor(args));

        if (typeof position.line === 'number' && typeof position.column === 'number') {
            return {
                line: createLineNumber(position.line - 1), // Back to 0-indexed lines
                column: createColumnNumber(position.column),
                source: parseResourceIdentifier(this._generatedPath)
            };
        } else {
            throw new Error(localize('error.sourceMap.cantFindGeneratedPosition', "Couldn't find generated position for {0}", JSON.stringify(lookupArgs)));
        }
    }

    private tryInBothDirections<T extends { line: number }, R extends { line: number | null }>(args: T, action: (argsWithBias: T & { bias?: number }) => R): R {
        const goForward = Object.assign({}, args, { bias: (<any>SourceMapConsumer).LEAST_UPPER_BOUND });
        const result = action(goForward);
        if (typeof result.line === 'number') {
            return result;
        } else {
            const goBackwards = Object.assign({}, args, { bias: (<any>SourceMapConsumer).GREATEST_LOWER_BOUND });
            return action(goBackwards);
        }
    }

    private isNonNullablePosition(position: NullablePosition): position is NonNullablePosition {
        return position.line !== null && position.column !== null;
    }

    public allGeneratedPositionFor(positionInSource: LocationInLoadedSource | LocationInSource): Range[] {
        const lookupArgs = {
            line: positionInSource.position.lineNumber + 1, // source-map lib uses 1-indexed lines.
            column: positionInSource.position.columnNumber,
            source: positionInSource.resourceIdentifier.canonicalized
        };

        const positions = this.allGeneratedPositionsForBothDirections(lookupArgs);

        const validPositions = <NonNullablePosition[]>positions.filter(p => this.isNonNullablePosition(p));
        if (validPositions.length < positions.length) {
            const invalidPositions = _.difference(positions, validPositions);
            logger.log(`WARNING: Some source map positions for: ${JSON.stringify(lookupArgs)} were discarded because they weren't valid: ${JSON.stringify(invalidPositions)}`);
        }

        /**
         * I didn't find in the documentation what are the semantics of lastColumn being null or Infinity. I'm assuming this is the correct thing to do
         * We'll fix it if we realize it's not... if it's null, we'll replace it by position.column. If it's Infinity we assume it includes the full line
         */
        return validPositions.map(position => Range.acrossSingleLine(
            createLineNumber(position.line - 1), // Back to 0-indexed lines
            createColumnNumber(position.column),
            createColumnNumber(_.defaultTo(position.lastColumn, position.column) + 1)) // position.lastColumn is inclusive and Range uses exclusive ranges, so we add 1
        );
    }

    private allGeneratedPositionsForBothDirections(originalPosition: MappedPosition): NullablePosition[] {
        const positions = this._smc.allGeneratedPositionsFor(originalPosition);
        if (positions.length !== 0) {
            return positions;
        } else {
            const position = this.tryInBothDirections(originalPosition, args => this._smc.generatedPositionFor(args));
            return [position];
        }
    }

    public rangesInSources(): IValidatedMap<IResourceIdentifier, Range> {
        // IMPORTANT TODO: Analyze the performance of the DA for large source maps. We'll probably need to not call this._smc!.eachMapping,
        // or call it async instead of blocking other things...
        const sourceToRange = newResourceIdentifierMap<Range>();
        const memoizedParseResourceIdentifier = _.memoize(parseResourceIdentifier);
        this._smc!.eachMapping(mapping => {
            // tslint:disable-next-line: strict-type-predicates - These values are sometimes null
            if (typeof mapping.originalLine === 'number' && typeof mapping.originalColumn === 'number' && typeof mapping.source === 'string') {
                // Mapping's line numbers are 1-based so we substract one (columns are 0-based)
                const positionInSource = new Position(createLineNumber(mapping.originalLine - 1), createColumnNumber(mapping.originalColumn));
                const sourceIdentifier = memoizedParseResourceIdentifier(mapping.source);
                const range = sourceToRange.getOr(sourceIdentifier, () => new Range(positionInSource, positionInSource));
                const expandedRange = new Range(
                    Position.appearingFirstOf(range.start, positionInSource),
                    Position.appearingLastOf(range.exclusiveEnd, positionInSource));
                sourceToRange.setAndReplaceIfExists(sourceIdentifier, expandedRange);
            } else {
                /**
                 * TODO: Report some telemetry. We've seen the line numbers and source be null in the Webpack scenario of our integration tests
                 * There are probably more scenarios like these
                 */
            }
        });

        return sourceToRange;
    }

    /**
     * We need to call this method to release the memory associated with the source-map
     */
    // TODO: Figure out when should we call this method, and call it. Maybe when we clear the execution context?
    public destroy(): void {
        this._smc.destroy();
    }
}
