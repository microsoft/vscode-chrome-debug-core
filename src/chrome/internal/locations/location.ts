import * as Validation from '../../../validation';
import { IScript } from '../scripts/script';
import { ISource } from '../sources/source';
import { ILoadedSource } from '../sources/loadedSource';
import { logger } from 'vscode-debugadapter';
import { ColumnNumber, LineNumber, URLRegexp } from './subtypes';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { IResourceIdentifier, parseResourceIdentifier, URL } from '../sources/resourceIdentifier';

export type integer = number;

export class Position {
    constructor(
        public readonly lineNumber: LineNumber,
        public readonly columnNumber?: ColumnNumber) {
        Validation.zeroOrPositive('Line number', lineNumber);
        if (columnNumber !== undefined) {
            Validation.zeroOrPositive('Column number', columnNumber);
        }
    }

    public isSameAs(location: Position): boolean {
        return this.lineNumber === location.lineNumber
            && this.columnNumber === location.columnNumber;
    }

    public toString(): string {
        return this.columnNumber !== undefined
            ? `${this.lineNumber}:${this.columnNumber}`
            : `${this.lineNumber}`;
    }
}

interface ILocation<T extends ScriptOrSourceOrURLOrURLRegexp> {
    readonly lineNumber: integer;
    readonly columnNumber?: integer;
    readonly coordinates: Position;
    readonly resource: T;
}

export type ScriptOrSourceOrURLOrURLRegexp = IScript | ILoadedSource | ISource | URLRegexp | URL<CDTPScriptUrl>;

export type Location<T extends ScriptOrSourceOrURLOrURLRegexp> =
    T extends ISource ? LocationInSource : // Used when receiving locations from the client
    T extends ILoadedSource ? LocationInLoadedSource : // Used to translate between locations on the client and the debugee
    T extends IScript ? LocationInScript : // Used when receiving locations from the debugee
    T extends URLRegexp ? LocationInUrlRegexp : // Used when setting a breakpoint by URL in a local file path in windows, to make it case insensitive
    T extends URL<CDTPScriptUrl> ? LocationInUrl : // Used when setting a breakpoint by URL for case-insensitive URLs
    never;

abstract class LocationCommonLogic<T extends ScriptOrSourceOrURLOrURLRegexp> implements ILocation<T> {
    constructor(
        public readonly resource: T,
        public readonly coordinates: Position) { }

    public get lineNumber(): LineNumber {
        return this.coordinates.lineNumber;
    }

    public get columnNumber(): ColumnNumber {
        return this.coordinates.columnNumber;
    }

    public toString(): string {
        return `${this.resource}:${this.coordinates}`;
    }
}

export class LocationInSource extends LocationCommonLogic<ISource> {
    public get identifier(): ISource {
        return this.resource;
    }

    public tryResolvingSource<R>(
        whenSuccesfulDo: (locationInLoadedSource: LocationInLoadedSource) => R,
        whenFailedDo: (locationInSource: LocationInSource) => R): R {
        return this.identifier.tryResolving(
            loadedSource => whenSuccesfulDo(new LocationInLoadedSource(loadedSource, this.coordinates)),
            () => whenFailedDo(this));
    }

    public resolvedWith(loadedSource: ILoadedSource): LocationInLoadedSource {
        if (this.resource.sourceIdentifier.isEquivalent(loadedSource.identifier)) {
            return new LocationInLoadedSource(loadedSource, this.coordinates);
        } else {
            throw new Error(`Can't resolve a location with a source (${this}) to a location with a loaded source that doesn't match the unresolved source: ${loadedSource}`);
        }
    }
}

export class LocationInScript extends LocationCommonLogic<IScript> {
    public get script(): IScript {
        return this.resource;
    }

    public mappedToSource(): LocationInLoadedSource {
        const mapped = this.script.sourcesMapper.getPositionInSource({ line: this.lineNumber, column: this.columnNumber });
        if (mapped) {
            const loadedSource = this.script.getSource(parseResourceIdentifier(mapped.source));
            const result = new LocationInLoadedSource(loadedSource, new Position(mapped.line, mapped.column));
            logger.verbose(`SourceMap: ${this} to ${result}`);
            return result;
        } else {
            return new LocationInLoadedSource(this.script.developmentSource, this.coordinates);
        }
    }

    public mappedToUrl(): LocationInUrl {
        if (this.script.runtimeSource.doesScriptHasUrl()) {
            return new LocationInUrl(this.script.runtimeSource.identifier, this.coordinates);
        } else {
            throw new Error(`Can't convert a location in a script without an URL (${this}) into a location in an URL`);
        }
    }

    public isSameAs(locationInScript: LocationInScript): boolean {
        return this.script === locationInScript.script &&
            this.coordinates.isSameAs(locationInScript.coordinates);
    }

    public toString(): string {
        return `${this.resource}:${this.coordinates}`;
    }
}

export class LocationInLoadedSource extends LocationCommonLogic<ILoadedSource> {
    public get source(): ILoadedSource {
        return this.resource;
    }

    public mappedToScript(): LocationInScript {
        const mapped = this.source.script.sourcesMapper.getPositionInScript({
            source: this.source.identifier.textRepresentation,
            line: this.lineNumber,
            column: this.columnNumber
        });
        if (mapped) {
            const result = new LocationInScript(this.source.script, new Position(mapped.line, mapped.column));
            logger.verbose(`SourceMap: ${this} to ${result}`);
            return result;
        } else {
            throw new Error(`Couldn't map the location (${this.coordinates}) in the source $(${this.source}) to a script file`);
        }
    }
}

export class LocationInUrl extends LocationCommonLogic<IResourceIdentifier<CDTPScriptUrl>> {
    public get url(): URL<CDTPScriptUrl> {
        return this.resource;
    }
}

export class LocationInUrlRegexp extends LocationCommonLogic<URLRegexp> {
    public get urlRegexp(): URLRegexp {
        return this.resource;
    }
}
