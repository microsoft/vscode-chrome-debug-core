/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Position, Location, ScriptOrSourceOrURLOrURLRegexp, createLocation } from './location';
import { IScript } from '../scripts/script';

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

    public get start(): Location<TResource> {
        return createLocation(this.resource, this._start);
    }

    public get end(): Location<TResource> {
        return createLocation(this.resource, this._end);
    }
}

export type RangeInScript = RangeInResource<IScript>;