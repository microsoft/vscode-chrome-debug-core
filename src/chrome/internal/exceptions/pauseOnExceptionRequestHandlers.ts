import * as errors from '../../../errors';
import { injectable, inject } from 'inversify';
import { PauseOnExceptionOrRejection, IExceptionInformation } from './pauseOnException';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IPauseOnExceptionsStrategy, PauseOnAllExceptions, PauseOnUnhandledExceptions, DoNotPauseOnAnyExceptions, IPauseOnPromiseRejectionsStrategy, PauseOnAllRejections } from './strategies';
import { ExceptionStackTracePrinter } from './exceptionStackTracePrinter';
import { ConnectedCDAConfiguration } from '../../client/chromeDebugAdapter/cdaConfiguration';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IExceptionInfoResponseBody } from '../../../debugAdapterInterfaces';
import { ChromeDebugLogic } from '../../chromeDebugAdapter';

@injectable()
export class PauseOnExceptionRequestHandlers implements ICommandHandlerDeclarer {
    private readonly _exceptionStackTracePrintter = new ExceptionStackTracePrinter(this._configuration);

    public constructor(
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.PauseOnExceptionOrRejection) private readonly _pauseOnException: PauseOnExceptionOrRejection,
        ) { }

    public async setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments): Promise<void> {
        const exceptionsStrategy = this.toPauseOnExceptionsStrategy(args.filters);
        const promiseRejectionsStrategy = this.toPauseOnPromiseRejectionsStrategy(args.filters);
        await this._pauseOnException.setExceptionsStrategy(exceptionsStrategy);
        this._pauseOnException.setPromiseRejectionStrategy(promiseRejectionsStrategy);
    }

    public async exceptionInfo(args: DebugProtocol.ExceptionInfoArguments): Promise<IExceptionInfoResponseBody> {
        if (args.threadId !== ChromeDebugLogic.THREAD_ID) {
            throw errors.invalidThread(args.threadId);
        }

        return this.toExceptionInfo(await this._pauseOnException.latestExceptionInfo());
    }

    private toPauseOnExceptionsStrategy(exceptionFilters: string[]): IPauseOnExceptionsStrategy {
        if (exceptionFilters.indexOf('all') >= 0) {
            return new PauseOnAllExceptions();
        } else if (exceptionFilters.indexOf('uncaught') >= 0) {
            return new PauseOnUnhandledExceptions();
        } else {
            return new DoNotPauseOnAnyExceptions();
        }
    }

    private toPauseOnPromiseRejectionsStrategy(_exceptionFilters: string[]): IPauseOnPromiseRejectionsStrategy {
        return new PauseOnAllRejections();
        // TODO: Figure out how to implement this for node-debug
        // if (exceptionFilters.indexOf('promise_reject') >= 0) {
        //     return new PauseOnAllRejections();
        // } else {
        //     return new DoNotPauseOnAnyRejections();
        // }
    }

    private toExceptionInfo(info: IExceptionInformation): IExceptionInfoResponseBody {
        return {
            exceptionId: info.exceptionId,
            description: info.description,
            breakMode: info.breakMode,
            details: {
                message: info.details.message,
                formattedDescription: info.details.formattedDescription,
                stackTrace: this._exceptionStackTracePrintter.toStackTraceString(info.details.stackTrace),
                typeName: info.details.typeName,
            }
        };
    }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            setExceptionBreakpoints: args => this.setExceptionBreakpoints(args),
            exceptionInfo: args => this.exceptionInfo(args),
        });
    }
}