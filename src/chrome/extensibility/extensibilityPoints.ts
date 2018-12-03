import { ChromeConnection, ITargetFilter } from '../chromeConnection';
import { BasePathTransformer } from '../../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../../transformers/baseSourceMapTransformer';
import { LineColTransformer } from '../../transformers/lineNumberTransformer';
import { ILaunchRequestArgs, IAttachRequestArgs } from '../../debugAdapterInterfaces';
import { IDebugeeLauncher } from '../..';
import { interfaces } from 'inversify';

export interface IExtensibilityPoints {
    isPromiseRejectExceptionFilterEnabled: boolean;
    debugeeLauncher: interfaces.Newable<IDebugeeLauncher>;

    targetFilter?: ITargetFilter;

    chromeConnection?: typeof ChromeConnection;
    pathTransformer?: { new(): BasePathTransformer };
    sourceMapTransformer?: { new(enableSourcemapCaching?: boolean): BaseSourceMapTransformer };
    lineColTransformer?: { new(session: any): LineColTransformer };

    updateArguments<T extends ILaunchRequestArgs | IAttachRequestArgs>(argumentsFromClient: T): T;
}

export class OnlyProvideCustomLauncherExtensibilityPoints implements IExtensibilityPoints {
    public readonly isPromiseRejectExceptionFilterEnabled = false;

    targetFilter?: ITargetFilter;
    chromeConnection?: typeof ChromeConnection;
    pathTransformer?: new () => BasePathTransformer;
    sourceMapTransformer?: new (enableSourcemapCaching?: boolean) => BaseSourceMapTransformer;
    lineColTransformer?: new (session: any) => LineColTransformer;

    public updateArguments<T extends ILaunchRequestArgs | IAttachRequestArgs>(argumentsFromClient: T): T {
        return argumentsFromClient;
    }

    constructor(public readonly debugeeLauncher: interfaces.Newable<IDebugeeLauncher>) {

    }
}