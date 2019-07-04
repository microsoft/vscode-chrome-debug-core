/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IExtensibilityPoints } from '../../extensibility/extensibilityPoints';
import { IClientCapabilities, ILaunchRequestArgs, IAttachRequestArgs } from '../../../debugAdapterInterfaces';
import { ILoggingConfiguration } from '../../internal/services/logging';
import { ScenarioType } from './unconnectedCDA';
import { injectable } from 'inversify';
import { ISession } from '../session';
import * as utils from '../../../utils';
import { isDefined } from '../../utils/typedOperators';

export interface IConnectedCDAConfiguration {
    args: ILaunchRequestArgs | IAttachRequestArgs;
    isVSClient: boolean;
    extensibilityPoints: IExtensibilityPoints;
    loggingConfiguration: ILoggingConfiguration;
    session: ISession;
    clientCapabilities: IClientCapabilities;
    scenarioType: ScenarioType;
    userRequestedUrl: string | null;
}

@injectable()
export class ConnectedCDAConfiguration implements IConnectedCDAConfiguration {
    public readonly args: ILaunchRequestArgs | IAttachRequestArgs;

    public readonly isVSClient = this.clientCapabilities.clientID === 'visualstudio';

    constructor(
        public readonly extensibilityPoints: IExtensibilityPoints,
        public readonly loggingConfiguration: ILoggingConfiguration,
        public readonly session: ISession,
        public readonly clientCapabilities: IClientCapabilities,
        public readonly scenarioType: ScenarioType,
        private readonly originalArgs: ILaunchRequestArgs | IAttachRequestArgs) {
        this.args = this.extensibilityPoints.updateArguments(this.scenarioType, this.originalArgs);

        if (isDefined(this.args.pathMapping)) {
            for (const urlToMap in this.args.pathMapping) {
                this.args.pathMapping[urlToMap] = utils.canonicalizeUrl(this.args.pathMapping[urlToMap]);
            }
        }
    }

    /**
     * Get the url the user requested for launch/attach
     */
    public get userRequestedUrl() {
        let launchUrl: string | null = null;
        if (this.isLaunchArgs(this.args) && this.args.file) {
            launchUrl = utils.pathToFileURL(this.args.file);
        } else if (this.args.url) {
            launchUrl = this.args.url;
        }
        return launchUrl;
    }

    /** Type guard for args */
    private isLaunchArgs(_args: ILaunchRequestArgs | IAttachRequestArgs): _args is ILaunchRequestArgs {
        return this.scenarioType === ScenarioType.Launch;
    }

}
