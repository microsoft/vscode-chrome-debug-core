/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import { DebugProtocol } from 'vscode-debugprotocol';
import { LoadedSourceCallFrame, CallFrameWithState } from './callFrame';
import { functionDescription } from './callFramePresentation';
import { isDefined, isTrue } from '../../utils/typedOperators';

/**
 * The clients can requests the stack traces frames descriptions in different formats.
 * We use this function to create the description for the call frame according to the parameters supplied by the client.
 */
export function formatCallFrameDescription(callFrame: LoadedSourceCallFrame<CallFrameWithState>, formatArgs?: DebugProtocol.StackFrameFormat): string {
    const location = callFrame.location;

    let formattedDescription = functionDescription(callFrame.codeFlow.functionName, location.source);

    if (isDefined(formatArgs)) {
        if (isTrue(formatArgs.module)) {
            formattedDescription += ` [${path.basename(location.source.identifier.textRepresentation)}]`;
        }

        if (isTrue(formatArgs.line)) {
            formattedDescription += ` Line ${location.position.lineNumber}`;
        }
    }

    return formattedDescription;
}
