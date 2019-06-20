import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { FrameParser } from '../../client/frameParser';

@injectable()
export class CompletionsRequestHandler implements ICommandHandlerDeclarer {
    public constructor(
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic,
        private readonly _frameParser: FrameParser) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            completions: (args: DebugProtocol.CompletionsArguments) => this.completions(args)
        });
    }

    private async completions(args: DebugProtocol.CompletionsArguments): Promise<DebugProtocol.CompletionsResponse['body']> {
        const frame = this._frameParser.optionalFrameById(args.frameId);
        return await this._chromeDebugAdapter.completions({ frame, text: args.text, column: args.column, line: args.line });
    }
}