import * as path from 'path';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ScriptCallFrame } from './callFrame';

/** The clients can requests the stack traces frames descriptions in different formats.
 * We use this class to create the description for the call frame according to the parameters supplied by the client.
 */

const ImplementsCallFrameDescriptionFormatter = Symbol();
export interface ICallFrameDescriptionFormatter {
    readonly description: string;

    [ImplementsCallFrameDescriptionFormatter]: void;
}

export class CustomCallFrameDescriptionFormatter implements ICallFrameDescriptionFormatter {
    [ImplementsCallFrameDescriptionFormatter]: void;

    public get description(): string {
        const locationInLoadedSource = this._callFrame.location.mappedToSource();

        let formattedDescription = this._callFrame.functionDescription;

        if (this._formatArgs) {
            if (this._formatArgs.module) {
                formattedDescription += ` [${path.basename(locationInLoadedSource.source.identifier.textRepresentation)}]`;
            }

            if (this._formatArgs.line) {
                formattedDescription += ` Line ${locationInLoadedSource.position.lineNumber}`;
            }
        }

        return formattedDescription;
    }

    constructor(private readonly _callFrame: ScriptCallFrame, private readonly _formatArgs?: DebugProtocol.StackFrameFormat) { }
}
