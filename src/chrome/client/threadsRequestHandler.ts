import { injectable, inject } from 'inversify';
import { ChromeDebugLogic } from '../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../internal/features/components';
import { TYPES } from '../dependencyInjection.ts/types';

@injectable()
export class ThreadsRequestHandler implements ICommandHandlerDeclarer {
    public constructor(@inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            threads: () => this._chromeDebugAdapter.threads()
        });
    }
}