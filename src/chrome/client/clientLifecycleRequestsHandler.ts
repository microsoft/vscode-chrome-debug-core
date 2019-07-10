import { TelemetryPropertyCollector } from '../../telemetry';
import { inject, injectable } from 'inversify';
import { TYPES } from '../dependencyInjection.ts/types';
import { ChromeDebugLogic } from '../chromeDebugAdapter';
import { IDebuggeeRunner } from '../debugeeStartup/debugeeLauncher';
import { StepProgressEventsEmitter } from '../../executionTimingsReporter';
import { ICommandHandlerDeclarer, ICommandHandlerDeclaration, CommandHandlerDeclaration } from '../internal/features/components';
import { ConnectedCDAConfiguration } from './chromeDebugAdapter/cdaConfiguration';
import { ScenarioType } from '../..';

@injectable()
export class ClientLifecycleRequestsHandler implements ICommandHandlerDeclarer {
    private readonly events = new StepProgressEventsEmitter();

    constructor(
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic,
        @inject(TYPES.ConnectedCDAConfiguration) protected readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.IDebuggeeRunner) public readonly _debuggeeRunner: IDebuggeeRunner,
    ) {
    }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            configurationDone: () => this.configurationDone()
        });
    }

    public async configurationDone(): Promise<void> {
        if (this._configuration.scenarioType === ScenarioType.Launch) {
            // At the moment it doesn't make sense to use the runner for attaching, so we only use it for launching
            await this._debuggeeRunner.run(new TelemetryPropertyCollector());
        }

        this.events.emitMilestoneReached('RequestedNavigateToUserPage'); // TODO DIEGO: Make sure this is reported
    }
}