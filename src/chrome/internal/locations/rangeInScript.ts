/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Position, Location, ScriptOrSourceOrURLOrURLRegexp, createLocation, LocationInScript } from './location';
import { IScript } from '../scripts/script';
import { printArray } from '../../collections/printing';

/** Used by CDTP getPossibleBreakpoints API to inquire the valid set of positions for a breakpoint in a particular range of the script */
export class RangeInResource<TResource extends ScriptOrSourceOrURLOrURLRegexp> {
    constructor(
        public readonly resource: TResource,
        private readonly _start: Position,
        private readonly _end: Position) {
        if (_start.lineNumber > _end.lineNumber
            || (_start.lineNumber === _end.lineNumber && _start.columnNumber > _end.columnNumber)) {
            throw new Error(`Can't create a range in a resource ${resource} where the end position (${_end}) happens before the start position ${_start}`);
        }
    }

    public static characterAt(characterLocation: LocationInScript): RangeInResource<IScript> {
        return new RangeInResource<IScript>(characterLocation.script, characterLocation.position, characterLocation.position);
    }

    public get start(): Location<TResource> {
        return createLocation(this.resource, this._start);
    }

    public get end(): Location<TResource> {
        return createLocation(this.resource, this._end);
    }

    public static enclosingAll(manyRanges: RangeInResource<IScript>[]) {
        if (manyRanges.length === 0) {
            throw new Error(`Can't find the enclosing range of an empty list of ranges`);
        } else {
            const script = manyRanges[0].resource;
            const rangesWithDifferentScript = manyRanges.filter(range => range.resource !== script);
            if (rangesWithDifferentScript.length >= 1) {
                throw new Error(`Expected all the ranges to refer to the same resource yet the first range refered to: ${script} while some ranges refered to ${printArray('other resources', rangesWithDifferentScript)}`);
            }

            const firstPosition = Position.appearingFirstOf(...manyRanges.map(range => range.start.position));
            const lastPosition = Position.appearingLastOf(...manyRanges.map(range => range.end.position));
            return new RangeInResource(manyRanges[0].resource, firstPosition, lastPosition);
        }
    }

    public toString(): string {
        return `${this.resource} @ [${this.start.position} to ${this.end.position}]`;
    }
}

export type RangeInScript = RangeInResource<IScript>;