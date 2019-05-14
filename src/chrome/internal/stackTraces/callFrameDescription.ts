/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as path from 'path';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ScriptCallFrame, CallFrameWithState } from './callFrame';
import { isTrue, isDefined } from '../../utils/typedOperators';

/** The clients can requests the stack traces frames descriptions in different formats.
 * We use this class to create the description for the call frame according to the parameters supplied by the client.
 */

const ImplementsCallFrameDescriptionFormatter = Symbol();
export interface ICallFrameDescriptionFormatter {
    readonly description: string;

    [ImplementsCallFrameDescriptionFormatter]: string;
}

export class CustomCallFrameDescriptionFormatter implements ICallFrameDescriptionFormatter {
    [ImplementsCallFrameDescriptionFormatter]: 'CustomCallFrameDescriptionFormatter';

    public get description(): string {
        const locationInLoadedSource = this._callFrame.location.mappedToSource();

        let formattedDescription = this._callFrame.functionName;

        if (isDefined(this._formatArgs)) {
            if (isTrue(this._formatArgs.module)) {
                formattedDescription += ` [${path.basename(locationInLoadedSource.source.identifier.textRepresentation)}]`;
            }

            if (isTrue(this._formatArgs.line)) {
                formattedDescription += ` Line ${locationInLoadedSource.position.lineNumber}`;
            }
        }

        return formattedDescription;
    }

    constructor(private readonly _callFrame: ScriptCallFrame<CallFrameWithState>, private readonly _formatArgs?: DebugProtocol.StackFrameFormat) { }
}
