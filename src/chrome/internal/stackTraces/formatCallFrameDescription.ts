import * as path from 'path';
import { DebugProtocol } from 'vscode-debugprotocol';
import { LoadedSourceCallFrame } from './callFrame';
import { functionDescription } from './callFramePresentation';

/** The clients can requests the stack traces frames descriptions in different formats.
 * We use this function to create the description for the call frame according to the parameters supplied by the client.
 */
export function formatCallFrameDescription(callFrame: LoadedSourceCallFrame, formatArgs?: DebugProtocol.StackFrameFormat): string {
    const location = callFrame.location;

    let formattedDescription = functionDescription(callFrame.codeFlow.functionName, location.source.script);

    if (formatArgs) {
        if (formatArgs.module) {
            formattedDescription += ` [${path.basename(location.source.identifier.textRepresentation)}]`;
        }

        if (formatArgs.line) {
            formattedDescription += ` Line ${location.position.lineNumber}`;
        }
    }

    return formattedDescription;
}
