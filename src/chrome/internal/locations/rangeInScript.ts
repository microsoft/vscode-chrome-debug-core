/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Position, Location, ScriptOrSourceOrURLOrURLRegexp, createLocation, LocationInScript } from './location';
import { IScript } from '../scripts/script';
import { createColumnNumber, createLineNumber, LineNumber, ColumnNumber } from './subtypes';

export class Range {
    public constructor(
        readonly start: Position,
        readonly exclusiveEnd: Position) {
        if (start.lineNumber > exclusiveEnd.lineNumber
            || (start.lineNumber === exclusiveEnd.lineNumber && start.columnNumber > exclusiveEnd.columnNumber)) {
            throw new Error(`Can't create a range in where the end position (${exclusiveEnd}) happens before the start position ${start}`);
        }
    }

    public static at(position: Position): Range {
        return new Range(position, new Position(position.lineNumber, createColumnNumber(position.columnNumber + 1)));
    }

    public static untilNextLine(position: Position): Range {
        return new Range(position, new Position(createLineNumber(position.lineNumber + 1), createColumnNumber(0)));
    }

    public static acrossSingleLine(lineNumber: LineNumber, startingColumnNumber: ColumnNumber, endingExclusiveColumnNumber: ColumnNumber): Range {
        const exclusiveEnd = endingExclusiveColumnNumber === Infinity
            // If the column end is infinity, we assume that means that the range includes the whole line, so the exclusive end is the start of the next line
            ? new Position(createLineNumber(lineNumber + 1), createColumnNumber(0))
            : new Position(lineNumber, endingExclusiveColumnNumber);
        return new Range(new Position(lineNumber, startingColumnNumber), exclusiveEnd);
    }

    public static enclosingAll(manyRanges: Range[]) {
        if (manyRanges.length === 0) {
            throw new Error(`Can't find the enclosing range of an empty list of ranges`);
        } else {
            const firstPosition = Position.appearingFirstOf(...manyRanges.map(range => range.start));
            const lastPosition = Position.appearingLastOf(...manyRanges.map(range => range.exclusiveEnd));
            return new Range(firstPosition, lastPosition);
        }
    }

    public isEmpty(): boolean {
        return this.start.isEquivalentTo(this.exclusiveEnd);
    }

    public toString(): string {
        return `[${this.start} to ${this.exclusiveEnd}]`;
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

    public static wholeLine(script: IScript, lineNumber: LineNumber): RangeInResource<IScript> {
        const zeroColumnNumber = createColumnNumber(0);
        const nextLineNumber = createLineNumber(lineNumber + 1);

        return RangeInResource.fromPositions(script,
            new Position(lineNumber, zeroColumnNumber),
            new Position(nextLineNumber, zeroColumnNumber));
    }

    public get start(): Location<TResource> {
        return createLocation(this.resource, this.range.start);
    }

    public get end(): Location<TResource> {
        return createLocation(this.resource, this.range.exclusiveEnd);
    }

    public toString(): string {
        return `${this.resource} @ [${this.start.position} to ${this.end.position}]`;
    }
}

export type RangeInScript = RangeInResource<IScript>;
