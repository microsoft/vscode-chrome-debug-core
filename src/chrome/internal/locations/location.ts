/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as Validation from '../../../validation';
import { IScript, Script } from '../scripts/script';
import { ISource, isSource } from '../sources/source';
import { ILoadedSource, isLoadedSource } from '../sources/loadedSource';
import { ColumnNumber, LineNumber, URLRegexp, createURLRegexp, createLineNumber, createColumnNumber } from './subtypes';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { IResourceIdentifier, IURL, isResourceIdentifier } from '../sources/resourceIdentifier';
import { IEquivalenceComparable } from '../../utils/equivalence';
import _ = require('lodash');

export type integer = number;

export class Position implements IEquivalenceComparable {
    public static readonly origin = new Position(createLineNumber(0), createColumnNumber(0));

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

    public isOrigin(): boolean {
        return this.lineNumber === 0 && (this.columnNumber === undefined || this.columnNumber === 0);
    }

    public doesAppearBefore(right: Position): boolean {
        return this.lineNumber < right.lineNumber ||
            (this.lineNumber === right.lineNumber && this.columnNumber < right.columnNumber);
    }

    public toString(): string {
        return this.columnNumber !== undefined
            ? `${this.lineNumber}:${this.columnNumber}`
            : `${this.lineNumber}`;
    }

    public static appearingLastOf(...positions: Position[]): Position {
        return _.reduce(positions, (left, right) => left.doesAppearBefore(right) ? right : left);
    }

    public static appearingFirstOf(...positions: Position[]): Position {
        return _.reduce(positions, (left, right) => left.doesAppearBefore(right) ? left : right);
    }

    public static isBetween(start: Position, maybeInBetween: Position, end: Position): boolean {
        return !maybeInBetween.doesAppearBefore(start) && !end.doesAppearBefore(maybeInBetween);
    }
}

export interface ILocation<T extends ScriptOrSourceOrURLOrURLRegexp> extends IEquivalenceComparable {
    readonly position: Position;
    readonly resource: T;

    isEquivalentTo(right: this): boolean;
}

// The LocationInUrl is used with the URL that is associated with each Script in CDTP. This should be a URL, but it could also be a string that is not a valid URL
// For that reason we use IResourceIdentifier<CDTPScriptUrl> for this type, instead of IURL<CDTPScriptUrl>
export type ScriptOrSourceOrURLOrURLRegexp = ISource | ILoadedSource | IScript | URLRegexp | IResourceIdentifier<CDTPScriptUrl>;

export type Location<T extends ScriptOrSourceOrURLOrURLRegexp> = ILocation<T> &
    (T extends ISource ? LocationInSource : // Used when receiving locations from the client
        T extends ILoadedSource ? LocationInLoadedSource : // Used to translate between locations on the client and the debuggee
        T extends IScript ? LocationInScript : // Used when receiving locations from the debuggee
        T extends URLRegexp ? LocationInUrlRegexp : // Used when setting a breakpoint by URL in a local file path in windows, to make it case insensitive
        T extends IURL<CDTPScriptUrl> ? LocationInUrl : // Used when setting a breakpoint by URL for case-insensitive URLs
        ILocation<never>); // TODO: Figure out how to replace this by never (We run into some issues with the isEquivalentTo call if we do)

export function createLocation<T extends ScriptOrSourceOrURLOrURLRegexp>(resource: T, position: Position): Location<T> {
    if (isSource(resource)) {
        return <Location<T>>new LocationInSource(resource, position); // TODO: Figure out way to remove this cast
    } else if (isLoadedSource(resource)) {
        return <Location<T>>new LocationInLoadedSource(resource, position); // TODO: Figure out way to remove this cast
    } else if (resource instanceof Script) {
        return <Location<T>>new LocationInScript(resource, position); // TODO: Figure out way to remove this cast
    } else if (typeof resource === 'string') {
        return <Location<T>>new LocationInUrlRegexp(createURLRegexp(<string>resource), position); // TODO: Figure out way to remove this cast
    } else if (isResourceIdentifier(resource)) {
        return <Location<T>>new LocationInUrl(<IURL<CDTPScriptUrl>>resource, position); // TODO: Figure out way to remove this cast
    } else {
        Validation.breakWhileDebugging();
        throw Error(`Can't create a location because the type of resource ${resource} wasn't recognized`);
    }
}

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

    public tryResolving<R>(
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

/**
 * The position of the location in a script is always relative to the resource that contains the script. If the resource is just a script, then both positions will be the same.
 * If the script is an inline script in an .html file, and it starts on line 10, then the first line of the script will be line 10.
 */
export class LocationInScript extends BaseLocation<IScript> {
    public mappedToRuntimeSource(): LocationInLoadedSource {
        return new LocationInLoadedSource(this.script.runtimeSource, this.position);
    }

    public get script(): IScript {
        return this.resource;
    }

    public mappedToSource(): LocationInLoadedSource {
        return this.script.sourceMapper.getPositionInSource(this);
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

    public mappedToScript(): LocationInScript[] {
        return this.source.scriptMapper().mapToScripts(this);
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
