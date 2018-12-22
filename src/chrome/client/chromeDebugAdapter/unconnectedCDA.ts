import { InitializedEvent, Logger } from 'vscode-debugadapter';
import { ChromeDebugLogic, ChromeDebugSession, IAttachRequestArgs, IDebugAdapterState, ILaunchRequestArgs, ITelemetryPropertyCollector, LineColTransformer, utils } from '../../..';
import { IClientCapabilities } from '../../../debugAdapterInterfaces';
import * as errors from '../../../errors';
import { EagerSourceMapTransformer } from '../../../transformers/eagerSourceMapTransformer';
import { FallbackToClientPathTransformer } from '../../../transformers/fallbackToClientPathTransformer';
import { RemotePathTransformer } from '../../../transformers/remotePathTransformer';
import { ChromeConnection } from '../../chromeConnection';
import { Communicator, LoggingCommunicator } from '../../communication/communicator';
import { DependencyInjection } from '../../dependencyInjection.ts/di';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IExtensibilityPoints } from '../../extensibility/extensibilityPoints';
import { Logging, LoggingConfiguration } from '../../internal/services/logging';
import { ExecutionLogger } from '../../logging/executionLogger';
import { DelayMessagesUntilInitializedSession } from '../delayMessagesUntilInitializedSession';
import { DoNotPauseWhileSteppingSession } from '../doNotPauseWhileSteppingSession';
import { ConnectedCDAConfiguration } from './cdaConfiguration';
import { ConnectedCDA } from './connectedCDA';
import { ConnectedCDAEventsCreator } from './connectedCDAEvents';
import { UnconnectedCDACommonLogic } from './unconnectedCDACommonLogic';

export enum ScenarioType {
    Launch,
    Attach
}

export class UnconnectedCDA extends UnconnectedCDACommonLogic implements IDebugAdapterState {
    public chromeDebugAdapter(): ChromeDebugLogic {
        throw new Error('The chrome debug adapter can only be used when the debug adapter is connected');
    }

    public async launch(args: ILaunchRequestArgs, telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IDebugAdapterState> {
        return this.createConnection(ScenarioType.Launch, args, telemetryPropertyCollector);
    }

    public async attach(args: IAttachRequestArgs, telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IDebugAdapterState> {
        const updatedArgs = Object.assign({}, { port: 9229 }, args);
        return this.createConnection(ScenarioType.Attach, updatedArgs, telemetryPropertyCollector);
    }

    private parseLoggingConfiguration(args: ILaunchRequestArgs | IAttachRequestArgs): LoggingConfiguration {
        const traceMapping: { [key: string]: Logger.LogLevel | undefined } = { true: Logger.LogLevel.Warn, verbose: Logger.LogLevel.Verbose };
        const traceValue = args.trace && traceMapping[args.trace.toString().toLowerCase()];
        return { logLevel: traceValue, logFilePath: args.logFilePath, shouldLogTimestamps: args.logTimestamps };
    }

    private async createConnection(scenarioType: ScenarioType, args: ILaunchRequestArgs | IAttachRequestArgs, telemetryPropertyCollector?: ITelemetryPropertyCollector): Promise<IDebugAdapterState> {
        if (this._clientCapabilities.pathFormat !== 'path') {
            throw errors.pathFormat();
        }

        utils.setCaseSensitivePaths(this._clientCapabilities.clientID !== 'visualstudio'); // TODO DIEGO: Find a way to remove this
        const di = new DependencyInjection();

        const pathTransformerClass = this._clientCapabilities.supportsMapURLToFilePathRequest
            ? FallbackToClientPathTransformer
            : this._extensibilityPoints.pathTransformer || RemotePathTransformer;
        const sourceMapTransformerClass = this._extensibilityPoints.sourceMapTransformer || EagerSourceMapTransformer;
        const lineColTransformerClass = this._extensibilityPoints.lineColTransformer || LineColTransformer;
        const logging = new Logging().install(this.parseLoggingConfiguration(args));

        const chromeConnection = new (this._chromeConnectionClass)(undefined, args.targetFilter || this._extensibilityPoints.targetFilter);
        const communicator = new LoggingCommunicator(new Communicator(), new ExecutionLogger(logging));

        const debugeeLauncher = new this._extensibilityPoints.debugeeLauncher();
        const result = await debugeeLauncher.launch(args, telemetryPropertyCollector);
        await chromeConnection.attach(result.address, result.port, result.url, args.timeout, args.extraCRDPChannelPort);

        di
            .bindAll()
            .configureClass(LineColTransformer, lineColTransformerClass)
            // .configureClass(TYPES.IDebugeeLauncher, debugeeLauncher)
            .configureValue(TYPES.communicator, communicator)
            .configureValue(TYPES.EventsConsumedByConnectedCDA, new ConnectedCDAEventsCreator(communicator).create())
            .configureValue(TYPES.CDTPClient, chromeConnection.api)
            .configureValue(TYPES.ISession, new DelayMessagesUntilInitializedSession(new DoNotPauseWhileSteppingSession(this._session)))
            .configureValue(TYPES.BasePathTransformer, new pathTransformerClass())
            .configureValue(TYPES.BaseSourceMapTransformer, new sourceMapTransformerClass())
            .configureValue(TYPES.ChromeConnection, chromeConnection)
            .configureValue(TYPES.ConnectedCDAConfiguration, new ConnectedCDAConfiguration(this._extensibilityPoints,
                this.parseLoggingConfiguration(args),
                this._session,
                this._clientCapabilities,
                this._chromeConnectionClass,
                scenarioType,
                args));

        this._session.sendEvent(new InitializedEvent());

        return di.createClassWithDI<ConnectedCDA>(ConnectedCDA);
    }

    constructor(
        private readonly _extensibilityPoints: IExtensibilityPoints,
        private readonly _session: ChromeDebugSession,
        private readonly _clientCapabilities: IClientCapabilities,
        private readonly _chromeConnectionClass: typeof ChromeConnection
    ) {
        super();
    }
}