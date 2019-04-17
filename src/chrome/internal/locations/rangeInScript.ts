/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Position, Location, ScriptOrSourceOrURLOrURLRegexp, createLocation, LocationInScript } from './location';
import { IScript } from '../scripts/script';

export class Range {
    public constructor(
        readonly start: Position,
        readonly end: Position) {
        if (start.lineNumber > end.lineNumber
            || (start.lineNumber === end.lineNumber && start.columnNumber > end.columnNumber)) {
            throw new Error(`Can't create a range in where the end position (${end}) happens before the start position ${start}`);
        }
    }

    public static at(position: Position): Range {
        return new Range(position, position);
    }

    public static enclosingAll(manyRanges: Range[]) {
        if (manyRanges.length === 0) {
            throw new Error(`Can't find the enclosing range of an empty list of ranges`);
        } else {
            const firstPosition = Position.appearingFirstOf(...manyRanges.map(range => range.start));
            const lastPosition = Position.appearingLastOf(...manyRanges.map(range => range.end));
            return new Range(firstPosition, lastPosition);
        }
    }

    public toString(): string {
        return `[${this.start} to ${this.end}]`;
    }
}

/** Used by CDTP getPossibleBreakpoints API to inquire the valid set of positions for a breakpoint in a particular range of the script */
export class RangeInResource<TResource extends ScriptOrSourceOrURLOrURLRegexp> {
    constructor(
        public readonly resource: TResource,
        public readonly range: Range) { }

    public static fromPositions<TResource extends ScriptOrSourceOrURLOrURLRegexp>(resource: TResource, start: Position, end: Position): RangeInResource<TResource> {
        return new RangeInResource<TResource>(resource, new Range(start, end));
    }

    public static characterAt(characterLocation: LocationInScript): RangeInResource<IScript> {
        return RangeInResource.fromPositions(characterLocation.script, characterLocation.position, characterLocation.position);
    }

    public get start(): Location<TResource> {
        return createLocation(this.resource, this.range.start);
    }

    public get end(): Location<TResource> {
        return createLocation(this.resource, this.range.end);
    }

    public toString(): string {
        return `${this.resource} @ [${this.start.position} to ${this.end.position}]`;
    }
}

export type RangeInScript = RangeInResource<IScript>;
