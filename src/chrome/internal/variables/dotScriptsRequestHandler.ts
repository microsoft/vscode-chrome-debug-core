import * as utils from '../../../utils';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ConnectedCDA } from '../../client/chromeDebugAdapter/connectedCDA';
import { DotScriptCommand } from '../sources/features/dotScriptsCommand';

@injectable()
export class DotScriptsRequestHandler {
    public constructor(
        @inject(TYPES.DotScriptCommand) public readonly _dotScriptCommand: DotScriptCommand) { }

    public async dotScript(args: DebugProtocol.EvaluateArguments) {
        const scriptsRest = utils.lstrip(args.expression, ConnectedCDA.SCRIPTS_COMMAND).trim();
        await this._dotScriptCommand.handleScriptsCommand(scriptsRest);
    }
}