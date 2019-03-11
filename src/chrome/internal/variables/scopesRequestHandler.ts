import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IScopesResponseBody } from '../../../debugAdapterInterfaces';
import { CallFramePresentation } from '../stackTraces/callFramePresentation';
import { IStackTracePresentationRow } from '../stackTraces/stackTracePresentationRow';
import { HandlesRegistry } from '../../client/handlesRegistry';

@injectable()
export class ScopesRequestHandler implements ICommandHandlerDeclarer {
    public constructor(@inject(HandlesRegistry) private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            scopes: (args: DebugProtocol.ScopesArguments) => this.scopes(args)
        });
    }

    public scopes(args: DebugProtocol.ScopesArguments): IScopesResponseBody {
        const frame = this.getCallFrameById(args.frameId);
        if (frame instanceof CallFramePresentation) {
            return this._chromeDebugAdapter.scopes(frame.callFrame);
        } else {
            throw new Error(`Can't get scopes for the frame because a label frame is only a description of the different sections of the call stack`);
        }
    }

    // V1 reseted the frames on an onPaused event. Figure out if that is the right thing to do
    public getCallFrameById(frameId: number): IStackTracePresentationRow {
        return this._handlesRegistry.frames.getObjectById(frameId);
    }
}