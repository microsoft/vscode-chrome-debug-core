import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { DebugProtocol } from 'vscode-debugprotocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ConnectedCDA } from '../../client/chromeDebugAdapter/connectedCDA';
import { ITelemetryPropertyCollector } from '../../../telemetry';
import { IEvaluateResponseBody, ISetExpressionResponseBody } from '../../../debugAdapterInterfaces';
import { DotScriptsRequestHandler } from './dotScriptsRequestHandler';
import { HandlesRegistry } from '../../client/handlesRegistry';
import { isDefined } from '../../utils/typedOperators';
import { CallFramePresentation } from '../stackTraces/callFramePresentation';
import { LoadedSourceCallFrame, CallFrameWithState } from '../stackTraces/callFrame';

@injectable()
export class EvaluateRequestHandler implements ICommandHandlerDeclarer {
    public constructor(
        public readonly _dotScriptsRequestHandler: DotScriptsRequestHandler,
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            evaluate: (args: DebugProtocol.EvaluateArguments) => this.evaluate(args),
            setExpression: args => this.setExpression(args)
        });
    }

    public async evaluate(args: DebugProtocol.EvaluateArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IEvaluateResponseBody> {
        if (args.expression.startsWith(ConnectedCDA.SCRIPTS_COMMAND)) {
            await this._dotScriptsRequestHandler.dotScript(args);
            return <IEvaluateResponseBody>{ result: '', variablesReference: 0 };
        } else {
            const frame = isDefined(args.frameId)
                ? this.frameById(args.frameId)
                : undefined;
            return this._chromeDebugAdapter.evaluate({ context: args.context, expression: args.expression, format: args.format, frame });
        }
    }

    private frameById(frameId: number): LoadedSourceCallFrame<CallFrameWithState> | undefined {
        const stackTrace = this._handlesRegistry.frames.getObjectById(frameId);
        if (stackTrace instanceof CallFramePresentation && stackTrace.callFrame.hasState()) {
            return stackTrace.callFrame;
        } else {
            return undefined;
        }
    }

    public async setExpression(args: DebugProtocol.SetExpressionArguments): Promise<ISetExpressionResponseBody> {
        const reconstructedExpression = `${args.expression} = ${args.value}`;
        const evaluateEventArgs: DebugProtocol.EvaluateArguments = {
            expression: reconstructedExpression,
            frameId: args.frameId,
            format: args.format,
            context: 'repl'
        };

        const evaluateResult = await this.evaluate(evaluateEventArgs);
        return {
            value: evaluateResult.result
        };
        // Beware that after the expression is changed, the variables on the current stackFrame will not
        // be updated, which means the return value of the Runtime.getProperties request will not contain
        // this change until the breakpoint is released(step over or continue).
        //
        // See also: https://bugs.chromium.org/p/chromium/issues/detail?id=820535
    }
}