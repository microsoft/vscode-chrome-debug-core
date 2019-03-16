/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { ChromeConnection, ITargetFilter } from '../chromeConnection';
import { BasePathTransformer } from '../../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../../transformers/baseSourceMapTransformer';
import { LineColTransformer } from '../../transformers/lineNumberTransformer';
import { ILaunchRequestArgs, IAttachRequestArgs } from '../../debugAdapterInterfaces';
import { interfaces } from 'inversify';
import { IDebuggeeLauncher, IDebuggeeRunner } from '../debugeeStartup/debugeeLauncher';
import { IConnectedCDAConfiguration } from '../client/chromeDebugAdapter/cdaConfiguration';
import { ComponentCustomizationCallback, DependencyInjection } from '../dependencyInjection.ts/di';
import { CommandText } from '../client/requests';
import { ScenarioType } from '../client/chromeDebugAdapter/unconnectedCDA';

export type RequestProcessorFunction = (args: unknown) => Promise<unknown>;

export interface IExtensibilityPoints {
    componentCustomizationCallback: ComponentCustomizationCallback;
    isPromiseRejectExceptionFilterEnabled: boolean;
    debuggeeLauncher: interfaces.Newable<IDebuggeeLauncher>;
    debuggeeRunner: interfaces.Newable<IDebuggeeRunner>;

    targetFilter?: ITargetFilter;
    logFilePath: string;

    chromeConnection: typeof ChromeConnection;
    pathTransformer?: { new(configuration: IConnectedCDAConfiguration): BasePathTransformer };
    sourceMapTransformer?: { new(configuration: IConnectedCDAConfiguration): BaseSourceMapTransformer };
    lineColTransformer?: { new(configuration: IConnectedCDAConfiguration): LineColTransformer };

    bindAdditionalComponents(diContainer: DependencyInjection): void;
    customizeProtocolApi(protocolApi: CDTP.ProtocolApi): CDTP.ProtocolApi;
    updateArguments<T extends ILaunchRequestArgs | IAttachRequestArgs>(scenarioType: ScenarioType, argumentsFromClient: T): T;

    processRequest(requestName: CommandText, args: unknown, defaultRequestProcessor: RequestProcessorFunction): Promise<unknown>;
}

export class OnlyProvideCustomLauncherExtensibilityPoints implements IExtensibilityPoints {
    public readonly isPromiseRejectExceptionFilterEnabled = false;

    targetFilter?: ITargetFilter;
    chromeConnection: typeof ChromeConnection = ChromeConnection;
    pathTransformer?: new (configuration: IConnectedCDAConfiguration) => BasePathTransformer;
    sourceMapTransformer?: new (configuration: IConnectedCDAConfiguration) => BaseSourceMapTransformer;
    lineColTransformer?: new (configuration: IConnectedCDAConfiguration) => LineColTransformer;

    constructor(
        public readonly logFilePath: string,
        public readonly debuggeeLauncher: interfaces.Newable<IDebuggeeLauncher>,
        public readonly debuggeeRunner: interfaces.Newable<IDebuggeeRunner>,
        public readonly componentCustomizationCallback: ComponentCustomizationCallback) {
    }

    public customizeProtocolApi(protocolApi: CDTP.ProtocolApi): CDTP.ProtocolApi {
        return protocolApi;
    }

    public bindAdditionalComponents(_diContainer: DependencyInjection): void {}

    public updateArguments<T extends ILaunchRequestArgs | IAttachRequestArgs>(scenarioType: ScenarioType, argumentsFromClient: T): T {
        return argumentsFromClient;
    }

    public processRequest(_requestName: CommandText, args: unknown, defaultRequestProcessor: RequestProcessorFunction): Promise<unknown> {
        return defaultRequestProcessor(args);
    }
}