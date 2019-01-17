/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Location } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { CodeFlowFrame, ICallFrame, CallFrame } from './callFrame';
import { CallFramePresentationHint, IStackTracePresentationRow } from './stackTracePresentationRow';
import { formatCallFrameDescription } from './formatCallFrameDescription';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IScript } from '../scripts/script';

export type SourcePresentationHint = 'normal' | 'emphasize' | 'deemphasize';

export interface ICallFramePresentationDetails {
    readonly additionalSourceOrigins: string[];
    readonly sourcePresentationHint: SourcePresentationHint;
}

export class CallFramePresentation implements IStackTracePresentationRow {
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

    public get description(): string {
        return formatCallFrameDescription(this.callFrame, this._descriptionFormatArgs);
    }

    constructor(
        public readonly callFrame: CallFrame<ILoadedSource>,
        private readonly _descriptionFormatArgs?: DebugProtocol.StackFrameFormat,
        public readonly additionalPresentationDetails?: ICallFramePresentationDetails,
        public readonly presentationHint?: CallFramePresentationHint) {
    }
}

export function functionDescription(functionName: string | undefined, functionModule: IScript): string {
    if (functionName) {
        return functionName;
    } else if (functionModule.runtimeSource.doesScriptHasUrl()) {
        return '(anonymous function)';
    } else {
        return '(eval code)';
    }
}
