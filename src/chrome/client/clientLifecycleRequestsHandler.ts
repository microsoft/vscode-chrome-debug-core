import { TelemetryPropertyCollector } from '../../telemetry';
import { inject, injectable } from 'inversify';
import { TYPES } from '../dependencyInjection.ts/types';
import { ChromeDebugLogic } from '../chromeDebugAdapter';
import { IDebuggeeRunner } from '../debugeeStartup/debugeeLauncher';
import { StepProgressEventsEmitter, ExecutionTimingsReporter } from '../../executionTimingsReporter';
import { ICommandHandlerDeclarer, ICommandHandlerDeclaration, CommandHandlerDeclaration } from '../internal/features/components';
import { ConnectedCDAConfiguration } from './chromeDebugAdapter/cdaConfiguration';
import { ScenarioType } from './chromeDebugAdapter/unconnectedCDA';

export class UserPageLaunchedError extends Error {
    public constructor(public readonly reason: string, message: string) {
        super(message);
    }
}

@injectable()
export class ClientLifecycleRequestsHandler implements ICommandHandlerDeclarer {
    private readonly events = new StepProgressEventsEmitter();

    constructor(
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic,
        @inject(TYPES.ConnectedCDAConfiguration) protected readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.IDebuggeeRunner) public readonly _debuggeeRunner: IDebuggeeRunner,
        @inject(TYPES.ExecutionTimingsReporter) reporter: ExecutionTimingsReporter,
    ) {
        reporter.subscribeTo(this.events);
    }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            configurationDone: () => this.configurationDone()
        });
    }

    public async configurationDone(): Promise<void> {
        // At the moment it doesn't make sense to use the runner for attaching, so we only use it for launching
        if (this._configuration.scenarioType === ScenarioType.Launch) {

            // We split the debuggeeRunner into run and waitUntilDebuggeeIsRunning because we don't want to fail or block the configurationDone
            // based on whether the debuggee succesfully starts to run or not (in Chrome case if loading the web-page fails we want
            // to leave the debug session open, so the user can see the error message in Chrome)
            await this._debuggeeRunner.run(new TelemetryPropertyCollector());

            // We don't want to block on this promise
            this._debuggeeRunner.waitUntilRunning().then(() => {
                this.events.emitMilestoneReached('RequestedNavigateToUserPage');
                this.events.emitFinishedStartingUp(true);
            }, (exception: unknown) => {
                const reason = exception instanceof UserPageLaunchedError
                    ? exception.reason
                    : 'UnspecifiedReason';
                this.events.emitFinishedStartingUp(false, reason);
            });
        }
    }
}