/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ChromeConnection, ITargetFilter } from '../chromeConnection';
import { BasePathTransformer } from '../../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../../transformers/baseSourceMapTransformer';
import { LineColTransformer } from '../../transformers/lineNumberTransformer';
import { ILaunchRequestArgs, IAttachRequestArgs } from '../../debugAdapterInterfaces';
import { interfaces } from 'inversify';
import { IDebuggeeLauncher, IDebuggeeRunner } from '../debugeeStartup/debugeeLauncher';
import { IConnectedCDAConfiguration } from '../client/chromeDebugAdapter/cdaConfiguration';
import { ComponentCustomizationCallback } from '../dependencyInjection.ts/di';

export interface IExtensibilityPoints {
    componentCustomizationCallback: ComponentCustomizationCallback;
    isPromiseRejectExceptionFilterEnabled: boolean;
    debuggeeLauncher: interfaces.Newable<IDebuggeeLauncher>;
    debuggeeRunner: interfaces.Newable<IDebuggeeRunner>;

    targetFilter?: ITargetFilter;
    logFilePath: string;

    chromeConnection?: typeof ChromeConnection;
    pathTransformer?: { new(configuration: IConnectedCDAConfiguration): BasePathTransformer };
    sourceMapTransformer?: { new(configuration: IConnectedCDAConfiguration): BaseSourceMapTransformer };
    lineColTransformer?: { new(configuration: IConnectedCDAConfiguration): LineColTransformer };

    updateArguments<T extends ILaunchRequestArgs | IAttachRequestArgs>(argumentsFromClient: T): T;
}

export class OnlyProvideCustomLauncherExtensibilityPoints implements IExtensibilityPoints {
    public readonly isPromiseRejectExceptionFilterEnabled = false;

    targetFilter?: ITargetFilter;
    chromeConnection?: typeof ChromeConnection;
    pathTransformer?: new (configuration: IConnectedCDAConfiguration) => BasePathTransformer;
    sourceMapTransformer?: new (configuration: IConnectedCDAConfiguration) => BaseSourceMapTransformer;
    lineColTransformer?: new (configuration: IConnectedCDAConfiguration) => LineColTransformer;

    constructor(
        public readonly logFilePath: string,
        public readonly debuggeeLauncher: interfaces.Newable<IDebuggeeLauncher>,
        public readonly debuggeeRunner: interfaces.Newable<IDebuggeeRunner>,
        public readonly componentCustomizationCallback: ComponentCustomizationCallback) {
    }

    public updateArguments<T extends ILaunchRequestArgs | IAttachRequestArgs>(argumentsFromClient: T): T {
        return argumentsFromClient;
    }
}