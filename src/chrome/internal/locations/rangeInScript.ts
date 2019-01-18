/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Position, LocationInScript } from './location';
import { IScript } from '../scripts/script';

/** Used by CDTP getPossibleBreakpoints API to inquire the valid set of positions for a breakpoint in a particular range of the script */
export class RangeInScript {
    constructor(
        public readonly script: IScript,
        public readonly start: Position,
        public readonly end: Position) {
        if (start.lineNumber > end.lineNumber
            || (start.lineNumber === end.lineNumber && start.columnNumber > end.columnNumber)) {
            throw new Error(`Can't create a range in a script ${script.runtimeSource} where the end position (${end}) happens before the start position ${start}`);
        }
    }

    public get startInScript(): LocationInScript {
        return new LocationInScript(this.script, this.start);
    }

    public get endInScript(): LocationInScript {
        return new LocationInScript(this.script, this.end);
    }
}
