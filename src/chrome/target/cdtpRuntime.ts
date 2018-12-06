import { Crdp } from '../..';
import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { CDTPStackTraceParser } from './cdtpStackTraceParser';

export class CDTPRuntime extends CDTPEventsEmitterDiagnosticsModule<Crdp.RuntimeApi> {

    public readonly onConsoleAPICalled = this.addApiListener('consoleAPICalled', async (params: Crdp.Runtime.ConsoleAPICalledEvent) =>
        ({
            args: params.args, context: params.context, executionContextId: params.executionContextId,
            stackTrace: params.stackTrace && await this._crdpToInternal.toStackTraceCodeFlow(params.stackTrace), timestamp: params.timestamp, type: params.type
        }));

    public enable(): Promise<void> {
        return this.api.enable();
    }

    public async runIfWaitingForDebugger(): Promise<void> {
        // This is a CDP version difference which will have to be handled more elegantly with others later...
        // For now, we need to send both messages and ignore a failing one.
        try {
            await Promise.all([
                this.api.runIfWaitingForDebugger(),
                (this.api as any).run()
            ]);
        } catch (exception) {
            // Ignore the failed call
        }
    }

    constructor(
        protected readonly api: Crdp.RuntimeApi,
        private readonly _crdpToInternal: CDTPStackTraceParser) {
        super();
    }
}
