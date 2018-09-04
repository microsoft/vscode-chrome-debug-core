import * as Validation from '../../../validation';
import { IScript } from '../scripts/script';
import { ISourceResolver } from '../sources/sourceResolver';
import { ILoadedSource } from '../sources/loadedSource';
import { URLRegexp } from '../breakpoints/bpRecipie';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { logger } from 'vscode-debugadapter';
import { ColumnNumber, LineNumber } from './subtypes';
import { IResourceIdentifier, parseResourceIdentifier } from '../sources/resourceIdentifier';

export type integer = number;

export class Coordinates {
    public isSameAs(location: Coordinates): boolean {
        return this.lineNumber === location.lineNumber
            && this.columnNumber === location.columnNumber;
    }

    public toString(): string {
        return this.columnNumber !== undefined
            ? `${this.lineNumber}:${this.columnNumber}`
            : `${this.lineNumber}`;
    }

    constructor(
        public readonly lineNumber: LineNumber,
        public readonly columnNumber?: ColumnNumber) {
        Validation.zeroOrPositive('Line number', lineNumber);
        if (columnNumber !== undefined) {
            Validation.zeroOrPositive('Column number', columnNumber);
        }
    }
}

export type ScriptOrSource = IScript | ILoadedSource;
export type ScriptOrSourceOrIdentifier = ScriptOrSource | ISourceResolver;
export type ScriptOrSourceOrIdentifierOrUrlRegexp = ScriptOrSourceOrIdentifier | IResourceIdentifier | URLRegexp | IResourceIdentifier<CDTPScriptUrl>;

interface ILocation<T extends ScriptOrSourceOrIdentifierOrUrlRegexp> {
    readonly lineNumber: NonNullable<integer>;
    readonly columnNumber?: integer;
    readonly coordinates: NonNullable<Coordinates>;
    readonly resource: NonNullable<T>;
}

export type Location<T extends ScriptOrSourceOrIdentifierOrUrlRegexp> =
    T extends IScript ? LocationInScript :
    T extends ISourceResolver ? LocationInUnresolvedSource :
    T extends ILoadedSource ? LocationInLoadedSource :
    T extends IResourceIdentifier ? ILocation<IResourceIdentifier> :
    T extends IResourceIdentifier<CDTPScriptUrl> ? ILocation<IResourceIdentifier<CDTPScriptUrl>> :
    T extends URLRegexp ? ILocation<URLRegexp> :
    never;

abstract class LocationCommonLogic<T extends ScriptOrSourceOrIdentifierOrUrlRegexp> implements ILocation<T> {
    public get lineNumber(): NonNullable<LineNumber> {
        return this.coordinates.lineNumber;
    }

    public get columnNumber(): ColumnNumber {
        return this.coordinates.columnNumber;
    }

    public toString(): string {
        return `${this.resource}:${this.coordinates}`;
    }

    constructor(
        public readonly resource: NonNullable<T>,
        public readonly coordinates: NonNullable<Coordinates>) { }
}

export class LocationInUnresolvedSource extends LocationCommonLogic<ISourceResolver> implements ILocation<ISourceResolver> {
    public get identifier(): ISourceResolver {
        return this.resource;
    }

    public tryGettingLocationInLoadedSource<R>(
        whenSuccesfulDo: (locationInLoadedSource: Location<ILoadedSource>) => R,
        whenFailedDo: (locationInUnbindedSource: LocationInUnresolvedSource) => R): R {
        return this.identifier.tryResolving(
            loadedSource => whenSuccesfulDo(new LocationInLoadedSource(loadedSource, this.coordinates)),
            () => whenFailedDo(this));
    }

    public asLocationWithLoadedSource(loadedSource: ILoadedSource): LocationInLoadedSource {
        if (this.resource.sourceIdentifier.isEquivalent(loadedSource.identifier)) {
            return new LocationInLoadedSource(loadedSource, this.coordinates);
        } else {
            throw new Error(`Can't convert a location with an unbinded source (${this}) to a location with a loaded source that doesn't match the unbinded source: ${loadedSource}`);
        }
    }
}

interface IBindedLocation<T extends ScriptOrSourceOrIdentifierOrUrlRegexp> extends ILocation<T> {
    asLocationInLoadedSource(): LocationInLoadedSource;
    asLocationInScript(): LocationInScript;
}

export class LocationInScript extends LocationCommonLogic<IScript> implements IBindedLocation<IScript> {
    public get script(): NonNullable<IScript> {
        return this.resource;
    }

    public asLocationInLoadedSource(): LocationInLoadedSource {
        const mapped = this.script.sourcesMapper.getSourceLocation({ line: this.lineNumber, column: this.columnNumber });
        if (mapped) {
            const loadedSource = this.script.getSource(parseResourceIdentifier(mapped.source));
            const result = new LocationInLoadedSource(loadedSource, new Coordinates(mapped.line, mapped.column));
            logger.verbose(`SourceMap: ${this} to ${result}`);
            return result;
        } else {
            return new LocationInLoadedSource(this.script.developmentSource, this.coordinates);
        }
    }

    public asLocationInScript(): LocationInScript {
        return this;
    }

    public asLocationInUrl(): LocationInUrl {
        if (this.script.runtimeSource.doesScriptHasUrl()) {
            return new LocationInUrl(this.script.runtimeSource.identifier, this.coordinates);
        } else {
            throw new Error(`Can't convert a location in a script without an URL (${this}) into a location in a URL`);
        }
    }

    public isSameAs(locationInScript: LocationInScript): boolean {
        return this.script === locationInScript.script &&
            this.coordinates.isSameAs(locationInScript.coordinates);
    }

    public toString(): string {
        return `${this.resource.runtimeSource}:${this.coordinates}`;
    }
}

export class LocationInLoadedSource extends LocationCommonLogic<ILoadedSource> implements IBindedLocation<ILoadedSource> {
    public get source(): ILoadedSource {
        return this.resource;
    }

    public asLocationInLoadedSource(): LocationInLoadedSource {
        return this;
    }

    public asLocationInScript(): LocationInScript {
        const mapped = this.source.script.sourcesMapper.getScriptLocation({
            source: this.source.identifier.textRepresentation,
            line: this.lineNumber,
            column: this.columnNumber
        });
        if (mapped) {
            const result = new LocationInScript(this.source.script, new Coordinates(mapped.line, mapped.column));
            logger.verbose(`SourceMap: ${this} to ${result}`);
            return result;
        } else {
            throw new Error(`Couldn't map the location (${this.coordinates}) in the source $(${this.source}) to a script file`);
        }
    }
}

export class LocationInUrl extends LocationCommonLogic<IResourceIdentifier<CDTPScriptUrl>> implements ILocation<IResourceIdentifier<CDTPScriptUrl>> {
    public get url(): NonNullable<IResourceIdentifier<CDTPScriptUrl>> {
        return this.resource;
    }

    public get source(): never {
        throw new Error(`LocationInScript doesn't support the source property`);
    }
}

export class LocationInUrlRegexp extends LocationCommonLogic<URLRegexp> implements ILocation<URLRegexp> {
    public get urlRegexp(): NonNullable<URLRegexp> {
        return this.resource;
    }

    public get source(): never {
        throw new Error(`LocationInScript doesn't support the source property`);
    }
}
