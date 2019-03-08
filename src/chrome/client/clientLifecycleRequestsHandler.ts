import { TelemetryPropertyCollector } from '../../telemetry';
import { inject, injectable } from 'inversify';
import { TYPES } from '../dependencyInjection.ts/types';
import { ChromeDebugLogic } from '../chromeDebugAdapter';
import { IDebuggeeRunner } from '../debugeeStartup/debugeeLauncher';
import { StepProgressEventsEmitter } from '../../executionTimingsReporter';
import { ICommandHandlerDeclarer, ICommandHandlerDeclaration, CommandHandlerDeclaration } from '../internal/features/components';

@injectable()
export class ClientLifecycleRequestsHandler implements ICommandHandlerDeclarer {
    private readonly events = new StepProgressEventsEmitter();

    constructor(
        @inject(TYPES.ChromeDebugLogic) protected readonly _chromeDebugAdapter: ChromeDebugLogic,
        @inject(TYPES.IDebugeeRunner) public readonly _debugeeRunner: IDebuggeeRunner,
    ) {
    }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            configurationDone: () => this.configurationDone(),
            shutdown: () => this._chromeDebugAdapter.shutdown(),
            disconnect: () => this._chromeDebugAdapter.disconnect(),
        });
    }
    public async configurationDone(): Promise<void> {
        await this._debugeeRunner.run(new TelemetryPropertyCollector());
        this.events.emitMilestoneReached('RequestedNavigateToUserPage'); // TODO DIEGO: Make sure this is reported
    }
}