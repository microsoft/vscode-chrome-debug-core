/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as Validation from '../../../validation';
import { IScript } from '../scripts/script';
import { ISource } from '../sources/source';
import { ILoadedSource } from '../sources/loadedSource';
import { logger } from 'vscode-debugadapter';
import { ColumnNumber, LineNumber, URLRegexp } from './subtypes';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { IResourceIdentifier, parseResourceIdentifier, IURL } from '../sources/resourceIdentifier';
import { IEquivalenceComparable } from '../../utils/equivalence';

export type integer = number;

export class Position implements IEquivalenceComparable {
    constructor(
        public readonly lineNumber: LineNumber,
        public readonly columnNumber?: ColumnNumber) {
        Validation.zeroOrPositive('Line number', lineNumber);
        if (columnNumber !== undefined) {
            Validation.zeroOrPositive('Column number', columnNumber);
        }
    }

    public isEquivalentTo(location: Position): boolean {
        return this.lineNumber === location.lineNumber
            && this.columnNumber === location.columnNumber;
    }

    public toString(): string {
        return this.columnNumber !== undefined
            ? `${this.lineNumber}:${this.columnNumber}`
            : `${this.lineNumber}`;
    }
}

export interface ILocation<T extends ScriptOrSourceOrURLOrURLRegexp> extends IEquivalenceComparable {
    readonly position: Position;
    readonly resource: T;
}

export type ScriptOrSourceOrURLOrURLRegexp = IScript | ILoadedSource | ISource | URLRegexp | IURL<CDTPScriptUrl>;

export type Location<T extends ScriptOrSourceOrURLOrURLRegexp> =
    T extends ISource ? LocationInSource : // Used when receiving locations from the client
    T extends ILoadedSource ? LocationInLoadedSource : // Used to translate between locations on the client and the debuggee
    T extends IScript ? LocationInScript : // Used when receiving locations from the debuggee
    T extends URLRegexp ? LocationInUrlRegexp : // Used when setting a breakpoint by URL in a local file path in windows, to make it case insensitive
    T extends IURL<CDTPScriptUrl> ? LocationInUrl : // Used when setting a breakpoint by URL for case-insensitive URLs
    ILocation<never>; // TODO: Figure out how to replace this by never (We run into some issues with the isEquivalentTo call if we do)

abstract class BaseLocation<T extends ScriptOrSourceOrURLOrURLRegexp> implements ILocation<T> {
    constructor(
        public readonly resource: T,
        public readonly position: Position) { }

    public isEquivalentTo(right: this): boolean {
        if (this.position.isEquivalentTo(right.position)) {
            if (typeof this.resource === 'string' || typeof right.resource === 'string') {
                return this.resource === right.resource;
            } else {
                return (<any>this.resource).isEquivalentTo(right.resource); // TODO: Make this any safer
            }
            return true;
        }
        return false;
    }

    public toString(): string {
        return `${this.resource}:${this.position}`;
    }
}

export class LocationInSource extends BaseLocation<ISource> implements ILocation<ISource> {
    public get identifier(): ISource {
        return this.resource;
    }

    public tryResolvingSource<R>(
        whenSuccesfulDo: (locationInLoadedSource: LocationInLoadedSource) => R,
        whenFailedDo: (locationInSource: LocationInSource) => R): R {
        return this.identifier.tryResolving(
            loadedSource => whenSuccesfulDo(new LocationInLoadedSource(loadedSource, this.position)),
            () => whenFailedDo(this));
    }

    public resolvedWith(loadedSource: ILoadedSource): LocationInLoadedSource {
        if (this.resource.sourceIdentifier.isEquivalentTo(loadedSource.identifier)) {
            return new LocationInLoadedSource(loadedSource, this.position);
        } else {
            throw new Error(`Can't resolve a location with a source (${this}) to a location with a loaded source that doesn't match the unresolved source: ${loadedSource}`);
        }
    }
}

export class LocationInScript extends BaseLocation<IScript> {
    public get script(): IScript {
        return this.resource;
    }

    public mappedToSource(): LocationInLoadedSource {
        const mapped = this.script.sourcesMapper.getPositionInSource({ line: this.position.lineNumber, column: this.position.columnNumber });
        if (mapped) {
            const loadedSource = this.script.getSource(parseResourceIdentifier(mapped.source));
            const result = new LocationInLoadedSource(loadedSource, new Position(mapped.line, mapped.column));
            logger.verbose(`SourceMap: ${this} to ${result}`);
            return result;
        } else {
            return new LocationInLoadedSource(this.script.developmentSource, this.position);
        }
    }

    public mappedToUrl(): LocationInUrl {
        if (this.script.runtimeSource.doesScriptHasUrl()) {
            return new LocationInUrl(this.script.runtimeSource.identifier, this.position);
        } else {
            throw new Error(`Can't convert a location in a script without an URL (${this}) into a location in an URL`);
        }
    }

    public isSameAs(locationInScript: LocationInScript): boolean {
        return this.script === locationInScript.script &&
            this.position.isEquivalentTo(locationInScript.position);
    }

    public toString(): string {
        return `${this.resource}:${this.position}`;
    }
}

export class LocationInLoadedSource extends BaseLocation<ILoadedSource> {
    public get source(): ILoadedSource {
        return this.resource;
    }

    public mappedToScript(): LocationInScript {
        const mapped = this.source.script.sourcesMapper.getPositionInScript({
            source: this.source.identifier.textRepresentation,
            line: this.position.lineNumber,
            column: this.position.columnNumber
        });
        if (mapped) {
            const result = new LocationInScript(this.source.script, new Position(mapped.line, mapped.column));
            logger.verbose(`SourceMap: ${this} to ${result}`);
            return result;
        } else {
            throw new Error(`Couldn't map the location (${this.position}) in the source $(${this.source}) to a script file`);
        }
    }
}

export class LocationInUrl extends BaseLocation<IResourceIdentifier<CDTPScriptUrl>> {
    public get url(): IURL<CDTPScriptUrl> {
        return this.resource;
    }
}

export class LocationInUrlRegexp extends BaseLocation<URLRegexp> {
    public get urlRegexp(): URLRegexp {
        return this.resource;
    }
}
