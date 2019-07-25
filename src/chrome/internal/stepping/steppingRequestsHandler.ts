/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { ICommandHandlerDeclarer, ICommandHandlerDeclaration, CommandHandlerDeclaration } from '../features/components';
import { AsyncStepping } from './features/asyncStepping';
import { SyncStepping } from './features/syncStepping';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { DebugProtocol } from 'vscode-debugprotocol';
import { HandlesRegistry } from '../../client/handlesRegistry';
import { CallFramePresentation } from '../stackTraces/callFramePresentation';

@injectable()
export class SteppingRequestsHandler implements ICommandHandlerDeclarer {
    constructor(
        @inject(TYPES.SyncStepping) private readonly _syncStepping: SyncStepping,
        @inject(TYPES.AsyncStepping) _asyncStepping: AsyncStepping, // We need this for the side-effects
        private readonly _handlesRegistry: HandlesRegistry,
    ) { }

    public async restartFrame(args: DebugProtocol.RestartFrameRequest): Promise<void> {
        const callFrame = this._handlesRegistry.frames.getObjectById(args.arguments.frameId);
        if (callFrame instanceof CallFramePresentation && callFrame.callFrame.hasState()) {
            return this._syncStepping.restartFrame(callFrame.callFrame.unmappedCallFrame);
        } else {
            throw new Error(localize('error.stepping.frameLacksStateInfo', `Cannot restart to a frame that doesn't have state information`));
        }
    }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            continue: () => this._syncStepping.continue(),
            next: () => this._syncStepping.stepOver(),
            stepIn: () => this._syncStepping.stepInto(),
            stepOut: () => this._syncStepping.stepOut(),
            pause: () => this._syncStepping.pause(),
            restartFrame: args => this._syncStepping.restartFrame(args)
        });
    }
}