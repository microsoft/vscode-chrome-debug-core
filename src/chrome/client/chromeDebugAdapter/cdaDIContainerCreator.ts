import * as path from 'path';
import Uri from 'vscode-uri';
import { Protocol as CDTP } from 'devtools-protocol';
import * as utils from '../../../utils';
import { DependencyInjection } from '../../dependencyInjection.ts/di';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ChromeDebugSession, IChromeDebugSessionOpts } from '../../chromeDebugSession';
import { DelayMessagesUntilInitializedSession } from '../delayMessagesUntilInitializedSession';
import { DoNotPauseWhileSteppingSession } from '../doNotPauseWhileSteppingSession';
import { UnconnectedCDA } from './unconnectedCDA';
import { IClientCapabilities, IAttachRequestArgs, ILaunchRequestArgs } from '../../../debugAdapterInterfaces';
import { ConnectingCDA } from './connectingCDA';
import { ConnectedCDA } from './connectedCDA';
import { ConnectedCDAConfiguration } from './cdaConfiguration';
import { ReplacementInstruction } from '../../logging/methodsCalledLogger';
import { Logging } from '../../internal/services/logging';
import { ChromeDebugAdapter } from './chromeDebugAdapterV2';
import { TerminatingCDA, TerminatingReason } from './terminatingCDA';
import { ChromeTargetDiscovery } from '../../chromeTargetDiscoveryStrategy';
import { ChromeConnection } from '../../chromeConnection';
import { telemetry } from '../../../telemetry';
import { isDefined, isNotEmpty } from '../../utils/typedOperators';

export function createDIContainer(chromeDebugAdapter: ChromeDebugAdapter, rawDebugSession: ChromeDebugSession, debugSessionOptions: IChromeDebugSessionOpts): DependencyInjection {
    const session = new DelayMessagesUntilInitializedSession(new DoNotPauseWhileSteppingSession(rawDebugSession));

    const diContainer = new DependencyInjection('ChromeDebugAdapter', debugSessionOptions.extensibilityPoints.componentCustomizationCallback);

    return diContainer
    .configureValue(TYPES.ISession, session)
    .configureValue(TYPES.ITelemetryReporter, telemetry)
    .configureValue(TYPES.ChromeDebugAdapter, chromeDebugAdapter)
        .configureValue(TYPES.IChromeDebugSessionOpts, debugSessionOptions)
        .configureValue(TYPES.UnconnectedCDAProvider, (clientCapabilities: IClientCapabilities) => {
            diContainer.configureValue<IClientCapabilities>(TYPES.IClientCapabilities, clientCapabilities);
            return diContainer.createComponent<UnconnectedCDA>(TYPES.UnconnectedCDA);
        })
        .configureClass(TYPES.IDebuggeeRunner, debugSessionOptions.extensibilityPoints.debuggeeRunner)
        .configureClass(TYPES.IDebuggeeInitializer, debugSessionOptions.extensibilityPoints.debuggeeInitializer)
        .configureClass(TYPES.IDebuggeeLauncher, debugSessionOptions.extensibilityPoints.debuggeeLauncher)
        .configureClass(TYPES.ChromeTargetDiscovery, ChromeTargetDiscovery)
        .configureClass(TYPES.ChromeConnection, ChromeConnection)
        .configureValue(TYPES.ILoggerSetter, (logger: Logging) => {
            diContainer.configureValue<Logging>(TYPES.ILogger, logger);
        })
        .configureValue(TYPES.ConnectingCDAProvider, (configuration: ConnectedCDAConfiguration) => {
            bindComponents(diContainer, configuration.args, debugSessionOptions.extensibilityPoints.bindAdditionalComponents);
            diContainer.configureValue<ConnectedCDAConfiguration>(TYPES.ConnectedCDAConfiguration, configuration);
            return diContainer.createComponent<ConnectingCDA>(TYPES.ConnectingCDA);
        })
        .configureValue(TYPES.ConnectedCDAProvider, (protocolApi: CDTP.ProtocolApi) => {
            const customizedProtocolApi = debugSessionOptions.extensibilityPoints.customizeProtocolApi(protocolApi);
            diContainer.configureValue<CDTP.ProtocolApi>(TYPES.CDTPClient, customizedProtocolApi);
            return diContainer.createComponent<ConnectedCDA>(TYPES.ConnectedCDA);
        })
        .configureValue(TYPES.TerminatingCDAProvider, (reason: TerminatingReason) => {
            diContainer.configureValue<TerminatingReason>(TYPES.TerminatingReason, reason);
            return diContainer.createComponent<TerminatingCDA>(TYPES.TerminatingCDA);
        });
}

function bindComponents(diContainer: DependencyInjection, args: ILaunchRequestArgs | IAttachRequestArgs, bindAdditionalComponents: (diContainer: DependencyInjection) => void): DependencyInjection {
    const replacements = [];

    if (isDefined(args.pathMapping) && isNotEmpty(args.pathMapping['/'])) {
        // replace the workspace path with 'ws' in the logs to avoid long lines
        const workspace = args.pathMapping['/'];
        const workspaceRegexp = utils.pathToRegex(workspace);
        replacements.push(new ReplacementInstruction(new RegExp(workspaceRegexp, 'gi'), '%ws%'));
    }

    const chromeUrl = (<any>args).url;
    if (chromeUrl) {
        replacements.push(new ReplacementInstruction(new RegExp((<any>args).url, 'gi'), '%url%'));
        const uri = Uri.parse(chromeUrl);
        const websitePath = path.dirname(uri.path);
        const websiteNoSeparator = websitePath[websitePath.length] === '/' ? websitePath.substr(0, -1) : websitePath;
        const website = uri.with({ path: websiteNoSeparator, query: '' }).toString();
        replacements.push(new ReplacementInstruction(new RegExp(website, 'gi'), '%website%'));
    }
    diContainer.updateLoggingReplacements(replacements);
    bindAdditionalComponents(diContainer);
    return diContainer;
}
