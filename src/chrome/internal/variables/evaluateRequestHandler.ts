import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ConnectedCDA } from '../../client/chromeDebugAdapter/connectedCDA';
import { ITelemetryPropertyCollector } from '../../../telemetry';
import { IEvaluateResponseBody } from '../../../debugAdapterInterfaces';
import { DotScriptsRequestHandler } from './dotScriptsRequestHandler';

@injectable()
export class EvaluateRequestHandler implements ICommandHandlerDeclarer {
    public constructor(
        @inject(DotScriptsRequestHandler) public readonly _dotScriptsRequestHandler: DotScriptsRequestHandler,
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            evaluate: (args: DebugProtocol.EvaluateArguments) => this._chromeDebugAdapter.evaluate(args)
        });
    }

    public async evaluate(args: DebugProtocol.EvaluateArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IEvaluateResponseBody> {
        if (args.expression.startsWith(ConnectedCDA.SCRIPTS_COMMAND)) {
            await this._dotScriptsRequestHandler.dotScript(args);
            return <IEvaluateResponseBody>{ result: '', variablesReference: 0 };
        } else {
            return this._chromeDebugAdapter.evaluate(args);
        }
    }
}