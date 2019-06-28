import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';

@injectable()
export class VariablesRequestHandler implements ICommandHandlerDeclarer {
    public constructor(@inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            variables: (args: DebugProtocol.VariablesArguments) => this._chromeDebugAdapter.variables(args),
            setVariable: (args: DebugProtocol.SetVariableArguments) => this._chromeDebugAdapter.setVariable(args)
        });
    }
}