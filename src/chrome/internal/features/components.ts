/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ConnectedCDAConfiguration } from '../../client/chromeDebugAdapter/cdaConfiguration';
import { PromiseOrNot } from '../../utils/promises';
import { CommandText } from '../../client/requests';
import { ITelemetryPropertyCollector } from '../../../telemetry';

export type RequestHandlerMappings = { [requestName: string]: RequestHandler };

export interface IInstallableComponent {
    install(): PromiseOrNot<this>;
}

export interface IServiceComponent extends IInstallableComponent {
}

export interface IConfigurableComponent {
    configure(configuration: ConnectedCDAConfiguration): Promise<this>;
}

export interface ICommandHandlerDeclaration {
    readonly commandName: CommandText;
    readonly commandHandler: RequestHandler;
}

export type RequestHandler = (args: any, telemetryPropertyCollector?: ITelemetryPropertyCollector) => PromiseOrNot<unknown>;
export class CommandHandlerDeclaration implements ICommandHandlerDeclaration {
    public constructor(
        public readonly commandName: CommandText,
        public readonly commandHandler: RequestHandler
    ) { }

    public static fromLiteralObject(mappings: RequestHandlerMappings): CommandHandlerDeclaration[] {
        return Object.keys(mappings).map(requestName => new CommandHandlerDeclaration(<CommandText>requestName, mappings[requestName]));
    }
}

export interface ICommandHandlerDeclarer {
    getCommandHandlerDeclarations(): PromiseOrNot<ICommandHandlerDeclaration[]>;
}
