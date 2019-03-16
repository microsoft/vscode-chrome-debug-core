
import { RequestProcessor } from './requestProcessor';
import { CommandText } from '../requests';
import { IDebugAdapterState } from '../../../debugAdapterInterfaces';
import { ICommandHandlerDeclarer, CommandHandlerDeclaration, RequestHandlerMappings } from '../../internal/features/components';
import { injectable } from 'inversify';

@injectable()
export abstract class BaseCDAState implements IDebugAdapterState {
    private readonly _requestProcessor: RequestProcessor;

    constructor(requestHandlerDeclarers: ICommandHandlerDeclarer[], requestHandlerMappings: RequestHandlerMappings) {
        const allDeclarers = requestHandlerDeclarers.concat({ getCommandHandlerDeclarations: () => CommandHandlerDeclaration.fromLiteralObject(requestHandlerMappings) });
        this._requestProcessor = new RequestProcessor(allDeclarers);
    }

    public async install(): Promise<this> {
        await this._requestProcessor.install();
        return this;
    }

    public async processRequest(requestName: CommandText, args: unknown): Promise<unknown> {
        return await this._requestProcessor.processRequest(requestName, args);
    }
}