
import { RequestProcessor } from './requestProcessor';
import { CommandText } from '../requests';
import { IDebugAdapterState } from '../../../debugAdapterInterfaces';
import { ICommandHandlerDeclarer, CommandHandlerDeclaration, RequestHandlerMappings } from '../../internal/features/components';
import { injectable } from 'inversify';
import { ISession } from '../session';

@injectable()
export abstract class BaseCDAState implements IDebugAdapterState {
    private readonly _requestProcessor: RequestProcessor;
    protected abstract readonly _session: ISession;

    constructor(
        requestHandlerDeclarers: ICommandHandlerDeclarer[],
        requestHandlerMappings: RequestHandlerMappings) {
        // Based on the documentation it seems that at any point/state in time, the client can send a disconnect request to
        // forcefully close the debug adapter. We add a default disconnect request handler to do that, for the states
        // that don't declare their own disconnect handler
        const requestHandlerMappingsWithDefault = { disconnect: () => this.shutdown(), ...requestHandlerMappings };
        const allDeclarers = requestHandlerDeclarers.concat({
            getCommandHandlerDeclarations: () => CommandHandlerDeclaration.fromLiteralObject(requestHandlerMappingsWithDefault)
        });
        this._requestProcessor = new RequestProcessor(`${this}`, allDeclarers);
    }

    public async install(): Promise<this> {
        await this._requestProcessor.install();
        return this;
    }

    public async processRequest(requestName: CommandText, args: unknown): Promise<unknown> {
        return await this._requestProcessor.processRequest(requestName, args);
    }

    public shutdown(): void {
        // this._batchTelemetryReporter.finalize();
        this._session.shutdown();
    }

    public toString(): string {
        return this.constructor.name;
    }
}