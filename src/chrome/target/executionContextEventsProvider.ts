import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { Crdp } from '../..';
import { inject, injectable } from 'inversify';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';
import { TYPES } from '../dependencyInjection.ts/types';

@injectable()
export class ExecutionContextEventsProvider extends CDTPEventsEmitterDiagnosticsModule<Crdp.RuntimeApi> {
    protected readonly api: Crdp.RuntimeApi = this._protocolApi.Runtime;

    public readonly onExecutionContextsCleared = this.addApiListener('executionContextsCleared', (params: void) => params);

    public readonly onExecutionContextDestroyed = this.addApiListener('executionContextDestroyed', async (params: Crdp.Runtime.ExecutionContextDestroyedEvent) =>
        this._scriptsRegistry.markExecutionContextAsDestroyed(params.executionContextId));

    public readonly onExecutionContextCreated = this.addApiListener('executionContextCreated', async (params: Crdp.Runtime.ExecutionContextCreatedEvent) =>
        this._scriptsRegistry.registerExecutionContext(params.context.id));

    constructor(
        @inject(TYPES.CDTPClient) private readonly _protocolApi: Crdp.ProtocolApi,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) {
        super();
    }
}