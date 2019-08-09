/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import * as nls from 'vscode-nls';

import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IScopesResponseBody } from '../../../debugAdapterInterfaces';
import { CallFramePresentation } from '../stackTraces/callFramePresentation';
import { IStackTracePresentationRow } from '../stackTraces/stackTracePresentationRow';
import { HandlesRegistry } from '../../client/handlesRegistry';
import { LocalizedError, registerGetLocalize } from '../../utils/localization';

let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

@injectable()
export class ScopesRequestHandler implements ICommandHandlerDeclarer {
    public constructor(
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            scopes: (args: DebugProtocol.ScopesArguments) => this.scopes(args)
        });
    }

    public scopes(args: DebugProtocol.ScopesArguments): IScopesResponseBody {
        const frame = this.getCallFrameById(args.frameId);
        if (frame instanceof CallFramePresentation && frame.callFrame.hasState()) {
            return this._chromeDebugAdapter.scopes(frame.callFrame);
        } else {
            throw new LocalizedError('error.scopes.frameLacksStateInfo', localize('error.scopes.frameLacksStateInfo', "Can't get scopes for a frame that has no associated state"));
        }
    }

    // V1 reseted the frames on an onPaused event. Figure out if that is the right thing to do
    public getCallFrameById(frameId: number): IStackTracePresentationRow {
        return this._handlesRegistry.frames.getObjectById(frameId);
    }
}