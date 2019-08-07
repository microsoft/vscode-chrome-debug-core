/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';

import { ValidatedMap } from '../../collections/validatedMap';
import { CommandText } from '../requests';
import { RequestHandler, ICommandHandlerDeclarer } from '../../internal/features/components';
import { printArray } from '../../collections/printing';
import { DoNotLog } from '../../logging/decorators';
import { LocalizedError, registerGetLocalize } from '../../utils/localizedError';

let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

export class RequestProcessor {
    private readonly _requestNameToHandler = new ValidatedMap<CommandText, RequestHandler>();

    public constructor(private readonly _stateDescription: string, private readonly _requestHandlerDeclarers: ICommandHandlerDeclarer[]) { }

    @DoNotLog()
    public async processRequest(requestName: CommandText, args: unknown): Promise<unknown> {
        const requestHandler = this._requestNameToHandler.tryGetting(requestName);
        if (requestHandler !== undefined) {
            return requestHandler.call('Process request has no this', args);
        } else {
            throw new LocalizedError('error.requestProcessor.unexpectedRequest', localize('error.requestProcessor.unexpectedRequest', 'Unexpected request: The request: {0} with arguments: {1} is not expected while in state: {2}', requestName, JSON.stringify(args), this._stateDescription));
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