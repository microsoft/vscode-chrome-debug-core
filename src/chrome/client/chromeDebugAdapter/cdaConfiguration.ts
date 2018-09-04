import { IExtensibilityPoints } from '../../extensibility/extensibilityPoints';
import { ChromeDebugSession } from '../../chromeDebugSession';
import { IClientCapabilities, ILaunchRequestArgs, IAttachRequestArgs } from '../../../debugAdapterInterfaces';
import { ChromeConnection } from '../../chromeConnection';
import { LoggingConfiguration } from '../../internal/services/logging';
import { utils } from '../../..';
import { ScenarioType } from './unconnectedCDA';

export class ConnectedCDAConfiguration {
    public readonly args: ILaunchRequestArgs | IAttachRequestArgs;

    constructor(public readonly _extensibilityPoints: IExtensibilityPoints,
        public readonly loggingConfiguration: LoggingConfiguration,
        public readonly _session: ChromeDebugSession,
        public readonly _clientCapabilities: IClientCapabilities,
        public readonly _chromeConnectionClass: typeof ChromeConnection,
        public readonly scenarioType: ScenarioType,
        private readonly originalArgs: ILaunchRequestArgs | IAttachRequestArgs) {
        this.args = this._extensibilityPoints.updateArguments(this.originalArgs);

        if (this.args.pathMapping) {
            for (const urlToMap in this.args.pathMapping) {
                this.args.pathMapping[urlToMap] = utils.canonicalizeUrl(this.args.pathMapping[urlToMap]);
            }
        }
    }
}
