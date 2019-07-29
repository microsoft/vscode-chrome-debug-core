/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IStackTraceResponseBody } from '../../../debugAdapterInterfaces';
import { CallFramePresentation } from '../stackTraces/callFramePresentation';
import { IStackTracePresentationRow, StackTraceLabel } from '../stackTraces/stackTracePresentationRow';
import { HandlesRegistry } from '../../client/handlesRegistry';
import { StackTracePresenter, StackTraceDefaultFormat, StackTraceCustomFormat } from './stackTracePresenter';
import { asyncMap } from '../../collections/async';
import { RemoveProperty } from '../../../typeUtils';
import { LocationInSourceToClientConverter } from '../../client/locationInSourceToClientConverter';
import { LineColTransformer } from '../../../transformers/lineNumberTransformer';
import { isDefined } from '../../utils/typedOperators';
import { ISourceToClientConverter } from '../../client/sourceToClientConverter';

/**
 * Handles and responds to the stackTrace requests from the client
 */
@injectable()
export class StackTraceRequestHandler implements ICommandHandlerDeclarer {
    private readonly _locationInSourceToClientConverter = new LocationInSourceToClientConverter(this._sourceToClientConverter, this._lineColTransformer);

    public constructor(
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.StackTracesLogic) private readonly _stackTraceLogic: StackTracePresenter,
        @inject(TYPES.SourceToClientConverter) private readonly _sourceToClientConverter: ISourceToClientConverter,
        @inject(TYPES.LineColTransformer) private readonly _lineColTransformer: LineColTransformer,
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic) { }

    public async getCommandHandlerDeclarations(): Promise<ICommandHandlerDeclaration[]> {
        await this._stackTraceLogic.install();
        return CommandHandlerDeclaration.fromLiteralObject({
            stackTrace: (args: DebugProtocol.StackTraceArguments) => this.stackTrace(args)
        });
    }

    public async stackTrace(args: DebugProtocol.StackTraceArguments): Promise<IStackTraceResponseBody> {
        const format = isDefined(args.format)
            ? new StackTraceCustomFormat(args.format)
            : new StackTraceDefaultFormat();

        const firstFrameIndex = typeof args.startFrame === 'number' ? args.startFrame : 0;
        const framesCountOrNull = typeof args.levels === 'number' ? args.levels : null;

        const stackTracePresentation = await this._stackTraceLogic.stackTrace(format, firstFrameIndex, framesCountOrNull);
        const clientStackTracePresentation = {
            stackFrames: await this.toStackFrames(stackTracePresentation.stackFrames),
            totalFrames: stackTracePresentation.totalFrames
        };
        return clientStackTracePresentation;
    }

    public toStackFrames(rows: IStackTracePresentationRow[]): Promise<DebugProtocol.StackFrame[]> {
        return asyncMap(rows, row => this.toStackFrame(row));
    }

    public getFrameId(stackFrame: IStackTracePresentationRow): number {
        return this._handlesRegistry.frames.getIdByObject(stackFrame);
    }

    public async toStackFrame(stackFrame: IStackTracePresentationRow): Promise<DebugProtocol.StackFrame> {
        if (stackFrame instanceof CallFramePresentation) {
            const clientStackFrame: RemoveProperty<DebugProtocol.StackFrame, 'line' | 'column'> = {
                id: this.getFrameId(stackFrame),
                name: stackFrame.description,
                presentationHint: stackFrame.presentationHint
            };

            const result = await this._locationInSourceToClientConverter.toLocationInSource(stackFrame.location, clientStackFrame);
            return result;
        } else if (stackFrame instanceof StackTraceLabel) {
            return {
                id: this.getFrameId(stackFrame),
                name: `[ ${stackFrame.description} ]`,
                presentationHint: 'label'
            } as DebugProtocol.StackFrame;
        } else {
            throw new Error(localize('error.stackTrace.unrecognizedStackFrameInstance', 'Expected stack frames to be either call frame presentations or label frames, yet it was: {0}', stackFrame.toString()));
        }
    }
}