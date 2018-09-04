import { UnconnectedCDACommonLogic } from './unconnectedCDACommonLogic';
import { ILaunchRequestArgs, ITelemetryPropertyCollector, IAttachRequestArgs, ChromeDebugLogic, IDebugAdapterState, ChromeDebugSession, BasePathTransformer, BaseSourceMapTransformer, LineColTransformer, utils } from '../../..';
import { ChromeConnection } from '../../chromeConnection';
import { IClientCapabilities } from '../../../debugAdapterInterfaces';
import { IExtensibilityPoints } from '../../extensibility/extensibilityPoints';
import { InitializedEvent, Logger } from 'vscode-debugadapter';
import { LoggingConfiguration, Logging } from '../../internal/services/logging';
import { DependencyInjection } from '../../dependencyInjection.ts/di';
import { ConnectedCDA } from './connectedCDA';
import { ConnectedCDAConfiguration } from './cdaConfiguration';
import { FallbackToClientPathTransformer } from '../../../transformers/fallbackToClientPathTransformer';
import { RemotePathTransformer } from '../../../transformers/remotePathTransformer';
import { EagerSourceMapTransformer } from '../../../transformers/eagerSourceMapTransformer';
import { DelayMessagesUntilInitializedSession } from '../delayMessagesUntilInitializedSession';
import { DoNotPauseWhileSteppingSession } from '../doNotPauseWhileSteppingSession';
import * as errors from '../../../errors';
import { TYPES } from '../../dependencyInjection.ts/types';
import { LoggingCommunicator, Communicator } from '../../communication/communicator';
import { ExecutionLogger } from '../../logging/executionLogger';
import { ConnectedCDAEventsCreator } from './connectedCDAEvents';

export enum ScenarioType {
    Launch,
    Attach
}

export class UnconnectedCDA extends UnconnectedCDACommonLogic implements IDebugAdapterState {
    public chromeDebugAdapter(): ChromeDebugLogic {
        throw new Error('The chrome debug adapter can only be used when the debug adapter is connected');
    }

    public async launch(args: ILaunchRequestArgs, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IDebugAdapterState> {
        return this.createConnection(ScenarioType.Launch, args);
    }

    public async attach(args: IAttachRequestArgs, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<IDebugAdapterState> {
        const updatedArgs = Object.assign({}, { port: 9229 }, args);
        return this.createConnection(ScenarioType.Attach, updatedArgs);
    }

    private parseLoggingConfiguration(args: ILaunchRequestArgs | IAttachRequestArgs): LoggingConfiguration {
        const traceMapping: { [key: string]: Logger.LogLevel | undefined } = { true: Logger.LogLevel.Warn, verbose: Logger.LogLevel.Verbose };
        const traceValue = traceMapping[args.trace.toString().toLowerCase()];
        return { logLevel: traceValue, logFilePath: args.logFilePath, shouldLogTimestamps: args.logTimestamps };
    }

    private async createConnection(scenarioType: ScenarioType, args: ILaunchRequestArgs | IAttachRequestArgs): Promise<IDebugAdapterState> {
        if (this._clientCapabilities.pathFormat !== 'path') {
            throw errors.pathFormat();
        }

        utils.setCaseSensitivePaths(this._clientCapabilities.clientID !== 'visualstudio'); // TODO DIEGO: Find a way to remove this
        this._session.sendEvent(new InitializedEvent());
        const di = new DependencyInjection();

        const pathTransformerClass = this._clientCapabilities.supportsMapURLToFilePathRequest
            ? FallbackToClientPathTransformer
            : this._extensibilityPoints.pathTransformer || RemotePathTransformer;
        const sourceMapTransformerClass = this._extensibilityPoints.sourceMapTransformer || EagerSourceMapTransformer;
        const lineColTransformerClass = this._extensibilityPoints.lineColTransformer || LineColTransformer;
        const logging = new Logging().install(this.parseLoggingConfiguration(args));

        const chromeConnection = new (this._chromeConnectionClass)(undefined, args.targetFilter || this._extensibilityPoints.targetFilter);
        const communicator = new LoggingCommunicator(new Communicator(), new ExecutionLogger(logging));

        return di
            .configureClass(LineColTransformer, lineColTransformerClass)
            .configureValue(TYPES.communicator, communicator)
            .configureValue(TYPES.EventsConsumedByConnectedCDA, new ConnectedCDAEventsCreator(communicator).create())
            .configureValue(TYPES.chromeConnectionApi, chromeConnection.api)
            .configureValue(TYPES.ISession, new DelayMessagesUntilInitializedSession(new DoNotPauseWhileSteppingSession(this._session)))
            .configureClass(BasePathTransformer, pathTransformerClass)
            .configureClass(BaseSourceMapTransformer, sourceMapTransformerClass)
            .configureValue(ChromeConnection, chromeConnection)
            .configureValue(ConnectedCDAConfiguration, new ConnectedCDAConfiguration(this._extensibilityPoints,
                this.parseLoggingConfiguration(args),
                this._session,
                this._clientCapabilities,
                this._chromeConnectionClass,
                scenarioType,
                args))
            .createClassWithDI<ConnectedCDA>(ConnectedCDA);
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