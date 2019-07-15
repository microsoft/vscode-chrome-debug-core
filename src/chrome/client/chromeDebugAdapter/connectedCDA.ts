/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { inject, injectable, multiInject } from 'inversify';
import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ICommandHandlerDeclarer, IServiceComponent } from '../../internal/features/components';
import { BaseCDAState } from './baseCDAState';
import { IDomainsEnabler } from '../../cdtpDebuggee/infrastructure/cdtpDomainsEnabler';
import { IRuntimeStarter } from '../../cdtpDebuggee/features/cdtpRuntimeStarter';
import { InitializedEvent } from 'vscode-debugadapter';
import { ISession } from '../session';
import { ChromeConnection } from '../../chromeConnection';
import { ChromeDebugAdapter } from './chromeDebugAdapterV2';
import { TerminatingCDAProvider } from './terminatingCDA';
import { BasePathTransformer } from '../../../transformers/basePathTransformer';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IDebuggeeInitializer, TerminatingReason } from '../../debugeeStartup/debugeeLauncher';
import { ISupportedDomains } from '../../internal/domains/supportedDomains';
import { StepProgressEventsEmitter, ExecutionTimingsReporter } from '../../../executionTimingsReporter';

export type ConnectedCDAProvider = (protocolApi: CDTP.ProtocolApi) => ConnectedCDA;

@injectable()
export class ConnectedCDA extends BaseCDAState {
    public static SCRIPTS_COMMAND = '.scripts';
    private _ignoreNextDisconnectedFromWebSocket = false;

    private readonly events = new StepProgressEventsEmitter();

    constructor(
        @inject(TYPES.ChromeDebugLogic) private readonly _chromeDebugAdapterLogic: ChromeDebugLogic,
        @inject(TYPES.IDomainsEnabler) private readonly _domainsEnabler: IDomainsEnabler,
        @inject(TYPES.IRuntimeStarter) private readonly _runtimeStarter: IRuntimeStarter,
        @inject(TYPES.IDebuggeeInitializer) private readonly _debuggeeInitializer: IDebuggeeInitializer,
        @inject(TYPES.ISession) protected readonly _session: ISession,
        @inject(TYPES.ChromeConnection) private readonly _chromeConnection: ChromeConnection,
        @inject(TYPES.TerminatingCDAProvider) private readonly _terminatingCDAProvider: TerminatingCDAProvider,
        @inject(TYPES.ChromeDebugAdapter) private readonly _chromeDebugAdapter: ChromeDebugAdapter,
        @multiInject(TYPES.IServiceComponent) private readonly _serviceComponents: IServiceComponent[],
        @inject(TYPES.BasePathTransformer) private readonly _basePathTransformer: BasePathTransformer,
        @multiInject(TYPES.ICommandHandlerDeclarer) requestHandlerDeclarers: ICommandHandlerDeclarer[],
        @inject(TYPES.ExecutionTimingsReporter) reporter: ExecutionTimingsReporter,
        @inject(TYPES.ISupportedDomains) private readonly _supportedDomains: ISupportedDomains,
    ) {
        super(requestHandlerDeclarers, {
            'initialize': () => { throw new Error('The debug adapter is already initialized. Calling initialize again is not supported.'); },
            'launch': () => { throw new Error("Can't launch  to a new target while connected to a previous target"); },
            'attach': () => { throw new Error("Can't attach to a new target while connected to a previous target"); },
            'disconnect': (args: DebugProtocol.DisconnectArguments) => this.disconnect(args),
        });
        reporter.subscribeTo(this.events);
    }

    private async disconnect(_args: DebugProtocol.DisconnectArguments): Promise<void> {
        // TODO: Add support for args.terminateDebuggee
        this._ignoreNextDisconnectedFromWebSocket = true;

        try {
            await this.terminate(TerminatingReason.ClientRequestedToDisconnect);
        } finally {
            await this.shutdown();
        }
    }

    public async install(): Promise<this> {
        this.events.emitStepStarted('Attach.ConfigureDebuggingSession');
        this._chromeConnection.onClose(async () => {
            if (!this._ignoreNextDisconnectedFromWebSocket) {
                // When the client requests a disconnect, we kill Chrome, which will in turn disconnect the websocket, so we'll also get this event.
                // To avoid processing the same disconnect twice, we ignore the first disconnect from websocket after the client requests a disconnect
                await this.terminate(TerminatingReason.DisconnectedFromWebsocket);
                this._ignoreNextDisconnectedFromWebSocket = false;
            }
        });

        await this._domainsEnabler.enableDomains(); // Enables all the domains that were registered
        await super.install(); // Some of the components make CDTP calls on their install methods. We need to call this after enabling domings, to prevent a component hanging this method
        await this._chromeDebugAdapterLogic.install();
        await this._basePathTransformer.install();
        await this._supportedDomains.install();

        for (const serviceComponent of this._serviceComponents) {
            await serviceComponent.install();
        }

        await this._runtimeStarter.runIfWaitingForDebugger();

        await this._debuggeeInitializer.initialize();

        this._session.sendEvent(new InitializedEvent());
        this.events.emitStepCompleted('NotifyInitialized');

        return this;
    }

    public async terminate(reason: TerminatingReason): Promise<void> {
        const terminatingCDA = this._terminatingCDAProvider(reason);
        await terminatingCDA.install();
        await this._chromeDebugAdapter.terminate(terminatingCDA);
    }

    public toString(): string {
        return `Connected to the debuggee`;
    }
}