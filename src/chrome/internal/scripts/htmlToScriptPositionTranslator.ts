/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { createLineNumber, createColumnNumber } from '../locations/subtypes';
import { Position, LocationInScript } from '../locations/location';

export class HtmlToScriptPositionTranslator {
    public toPositionRelativeToScript(positionOfScriptTagInHtml: Position, positionRelativeToHtml: LocationInScript): LocationInScript {
        // All the lines need to be adjusted by the relative position of the script in the resource (in an .html if the script starts in line 20, the first line is 20 rather than 0)
        const lineRelativeToScript = positionRelativeToHtml.position.lineNumber - positionOfScriptTagInHtml.lineNumber;

        // The columns on the first line need to be adjusted. Columns on all other lines don't need any adjustment.
        const columnRelativeToScript = (lineRelativeToScript === 0 ? positionOfScriptTagInHtml.columnNumber : 0)
            + positionRelativeToHtml.position.columnNumber;

        return new LocationInScript(positionRelativeToHtml.script,
            new Position(createLineNumber(lineRelativeToScript), createColumnNumber(columnRelativeToScript)));
    }
}