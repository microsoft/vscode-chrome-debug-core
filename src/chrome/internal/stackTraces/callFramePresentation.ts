/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import { Location } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { CodeFlowFrame, ICallFrame, CallFrame, ICallFrameState } from './callFrame';
import { CallFramePresentationHint, IStackTracePresentationRow } from './stackTracePresentationRow';
import { IStackTraceFormat, StackTraceCustomFormat } from './stackTracePresenter';

export type SourcePresentationHint = 'normal' | 'emphasize' | 'deemphasize';

export interface ICallFramePresentationDetails {
    readonly additionalSourceOrigins: string[];
    readonly sourcePresentationHint: SourcePresentationHint;
}

export class CallFramePresentation implements IStackTracePresentationRow {
    constructor(
        public readonly callFrame: CallFrame<ILoadedSource, ICallFrameState>,
        private readonly _descriptionFormatArgs?: IStackTraceFormat,
        public readonly additionalPresentationDetails?: ICallFramePresentationDetails,
        public readonly presentationHint?: CallFramePresentationHint) {
    }

    public get source(): ILoadedSource {
        return this.codeFlow.source;
    }

    public get location(): Location<ILoadedSource> {
        return this.codeFlow.location;
    }

    public get lineNumber(): number {
        return this.codeFlow.lineNumber;
    }

    public get columnNumber(): number {
        return this.codeFlow.columnNumber;
    }

    public get codeFlow(): CodeFlowFrame<ILoadedSource> {
        return (<ICallFrame<ILoadedSource>>this.callFrame).codeFlow; // TODO: Figure out how to remove the cast
    }

    public isCallFrame(): this is CallFramePresentation {
        return true;
    }

    /** The clients can requests the stack traces frames descriptions in different formats.
     * We use this method to create the description for the call frame according to the parameters supplied by the client.
     */
    public get description(): string {
        const location = this.callFrame.location;

        let formattedDescription = functionDescription(this.callFrame.codeFlow.functionName, location.source);

        if (this._descriptionFormatArgs instanceof StackTraceCustomFormat) {
            if (this._descriptionFormatArgs.formatOptions.module) {
                formattedDescription += ` [${path.basename(location.source.identifier.textRepresentation)}]`;
            }

            if (this._descriptionFormatArgs.formatOptions.line) {
                // The description property intended for the user, so we don't care if the client uses 0-index or 1-index line number. We send this as 1-index line number always
                const oneBasedLineNumber = location.position.lineNumber + 1;

                formattedDescription += ` Line ${oneBasedLineNumber}`;
            }
        }

        return formattedDescription;
    }
}

export function functionDescription(functionName: string | undefined, functionModule: ILoadedSource): string {
    if (functionName) {
        return functionName;
    } else if (functionModule.doesScriptHasUrl()) {
        return '(anonymous function)';
    } else {
        return '(eval code)';
    }
}
