import { ValidatedMap } from '../../collections/validatedMap';
import { CommandText } from '../requests';
import { RequestHandler, ICommandHandlerDeclarer } from '../../internal/features/components';
import { printArray } from '../../collections/printing';

export class RequestProcessor {
    private readonly _requestNameToHandler = new ValidatedMap<CommandText, RequestHandler>();

    public constructor(private readonly _stateDescription: string, private readonly _requestHandlerDeclarers: ICommandHandlerDeclarer[]) { }

    public async processRequest(requestName: CommandText, args: unknown): Promise<unknown> {
        const requestHandler = this._requestNameToHandler.tryGetting(requestName);
        if (requestHandler !== undefined) {
            return requestHandler.call('Process request has no this', args);
        } else {
            throw new Error(`Unexpected request: The request: ${requestName} with arguments: ${JSON.stringify(args)} is not expected while in state: ${this._stateDescription}`);
        }
    }

    public async install(): Promise<void> {
        for (const requestHandlerDeclarer of this._requestHandlerDeclarers) {
            for (const requestHandlerDeclaration of await requestHandlerDeclarer.getCommandHandlerDeclarations()) {
                this._requestNameToHandler.set(requestHandlerDeclaration.commandName, requestHandlerDeclaration.commandHandler);
            }
        }
    }

    public toString(): string {
        return printArray(`Request processor for`, Array.from(this._requestNameToHandler.keys()));
    }
}