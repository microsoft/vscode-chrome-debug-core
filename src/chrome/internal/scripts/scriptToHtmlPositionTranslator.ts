/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Position } from '../locations/location';
import { createLineNumber, createColumnNumber } from '../locations/subtypes';
import { Range } from '../locations/rangeInScript';

export class ScriptToHtmlPositionTranslator {
    public toPositionRelativeToHtml(positionOfScriptTagInHtml: Position, positionRelativeToScript: Position): Position {
        // All the lines need to be adjusted by the relative position of the script in the resource (in an .Html if the script starts in line 20, the first line is 20 rather than 0)
        const lineRelativeToHtml = createLineNumber(positionRelativeToScript.lineNumber + positionOfScriptTagInHtml.lineNumber);

        // The columns on the first line relative to the script need to be adjusted. Columns on all other lines don't need any adjustment.
        const columnRelativeToHtml = createColumnNumber(
            (positionRelativeToScript.lineNumber === 0 ? positionOfScriptTagInHtml.columnNumber : 0)
            + positionRelativeToScript.columnNumber);

        return new Position(lineRelativeToHtml, columnRelativeToHtml);
    }

    public toRangeRelativeToHtml(positionOfScriptInHtml: Position, rangeRelativeToScript: Range): Range {
        return new Range(
            this.toPositionRelativeToHtml(positionOfScriptInHtml, rangeRelativeToScript.start),
            this.toPositionRelativeToHtml(positionOfScriptInHtml, rangeRelativeToScript.exclusiveEnd));
    }

    public toManyRangesRelativeToHtml(positionOfScriptInHtml: Position, manyRangesRelativeToScript: Range[]): Range[] {
        return manyRangesRelativeToScript.map(positionInScript => this.toRangeRelativeToHtml(positionOfScriptInHtml, positionInScript));
    }
}