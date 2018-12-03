import * as promises from '../../utils/promises';
import { ConnectedCDAConfiguration } from '../../client/chromeDebugAdapter/cdaConfiguration';

export type PromiseOrNot<T> = promises.PromiseOrNot<T>;

export interface IConfigurableFeature<Configuration> {
    install(configuration: Configuration): PromiseOrNot<void | this>;
}

export interface IConfigurationlessFeature {
    install(): PromiseOrNot<void | this>;
}

export type ComponentConfiguration = ConnectedCDAConfiguration;

export type IComponent<Configuration = ComponentConfiguration> =
    Configuration extends void
    ? IConfigurationlessFeature
    : IConfigurableFeature<Configuration>;

export interface ICommandHandlerDeclaration {
    readonly commandName: string;
    readonly commandHandler: (args: any) => PromiseOrNot<void>;
}

export interface ICommandHandlerDeclarer {
    getCommandHandlerDeclarations(): PromiseOrNot<ICommandHandlerDeclaration>;
}
