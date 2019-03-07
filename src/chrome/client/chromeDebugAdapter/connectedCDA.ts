/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { inject, injectable, multiInject } from 'inversify';
import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ValidatedMap } from '../../collections/validatedMap';
import { CommandText } from '../requests';
import { RequestHandler, ICommandHandlerDeclarer } from '../../internal/features/components';

@injectable()
export class ConnectedCDA {
    public static SCRIPTS_COMMAND = '.scripts';

    private readonly _requestNameToHandler = new ValidatedMap<CommandText, RequestHandler>();

    constructor(
        @inject(TYPES.ChromeDebugLogic) private readonly _chromeDebugAdapter: ChromeDebugLogic,
        @multiInject(TYPES.ICommandHandlerDeclarer) private readonly _requestHandlerDeclarers: ICommandHandlerDeclarer[]
    ) { }

    public async processRequest(requestName: CommandText, args: unknown): Promise<unknown> {
        switch (requestName) {
            case 'initialize':
                throw new Error('The debug adapter is already initialized. Calling initialize again is not supported.');
            case 'launch':
            case 'attach':
                throw new Error("Can't launch or attach to a new target while connected to a previous target");
            default:
                return this._requestNameToHandler.get(requestName).call('Process request has no this', args);
        }
    }

    public async install(): Promise<this> {
        for (const requestHandlerDeclarer of this._requestHandlerDeclarers) {
            for (const requestHandlerDeclaration of await requestHandlerDeclarer.getCommandHandlerDeclarations()) {
                this._requestNameToHandler.set(requestHandlerDeclaration.commandName, requestHandlerDeclaration.commandHandler);
            }
        }

        await this._chromeDebugAdapter.install();

        return this;
    }
}
