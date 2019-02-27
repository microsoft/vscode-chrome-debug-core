/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { CDTPEventsEmitterDiagnosticsModule } from '../infrastructure/cdtpDiagnosticsModule';
import { Protocol as CDTP } from 'devtools-protocol';
import { CDTPStackTraceParser } from '../protocolParsers/cdtpStackTraceParser';
import { inject, injectable } from 'inversify';
import { CodeFlowStackTrace } from '../../internal/stackTraces/codeFlowStackTrace';
import { TYPES } from '../../dependencyInjection.ts/types';
import { CDTPScriptsRegistry } from '../registries/cdtpScriptsRegistry';
import { CDTPDomainsEnabler } from '../infrastructure/cdtpDomainsEnabler';

export type ConsoleAPIEventType = 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'dirxml' | 'table' | 'trace' | 'clear' | 'startGroup' | 'startGroupCollapsed' | 'endGroup' | 'assert' | 'profile' | 'profileEnd' | 'count' | 'timeEnd';

export interface IConsoleAPICalledEvent {
    readonly type: ConsoleAPIEventType;
    readonly args: CDTP.Runtime.RemoteObject[];
    readonly executionContextId: CDTP.Runtime.ExecutionContextId;
    readonly timestamp: CDTP.Runtime.Timestamp;
    readonly stackTrace?: CodeFlowStackTrace;
    readonly context?: string;
}

export type onMessageAddedListener = (message: CDTP.Console.MessageAddedEvent) => void;
export type onConsoleAPICalled = (message: IConsoleAPICalledEvent) => void;

export interface IConsoleEventsProvider {
    onMessageAdded(listener: onMessageAddedListener): void;
    onConsoleAPICalled(listener: onConsoleAPICalled): void;
}

class CDTPConsoleEventsFromConsoleProvider extends CDTPEventsEmitterDiagnosticsModule<CDTP.ConsoleApi>  {
    protected readonly api = this._protocolApi.Console;

    public readonly onMessageAdded = this.addApiListener('messageAdded', (params: CDTP.Console.MessageAddedEvent) => params);

    constructor(
        private readonly _protocolApi: CDTP.ProtocolApi,
        domainsEnabler: CDTPDomainsEnabler) {
        super(domainsEnabler);
    }
}

class CDTPConsoleEventsFromRuntimeProvider extends CDTPEventsEmitterDiagnosticsModule<CDTP.RuntimeApi> {
    protected readonly api = this._protocolApi.Runtime;
    private readonly _stackTraceParser = new CDTPStackTraceParser(this._scriptsRegistry);

    public readonly onConsoleAPICalled = this.addApiListener('consoleAPICalled', async (params: CDTP.Runtime.ConsoleAPICalledEvent) =>
        ({
            args: params.args,
            context: params.context,
            executionContextId: params.executionContextId,
            timestamp: params.timestamp,
            type: params.type,
            stackTrace: params.stackTrace && await this._stackTraceParser.toStackTraceCodeFlow(params.stackTrace)
        }));

    constructor(
        private readonly _protocolApi: CDTP.ProtocolApi,
        private _scriptsRegistry: CDTPScriptsRegistry,
        domainsEnabler: CDTPDomainsEnabler,
    ) {
        super(domainsEnabler);
    }
}

@injectable()
export class CDTPConsoleEventsProvider implements IConsoleEventsProvider {
    private readonly _consoleEventsFromConsoleProvider = new CDTPConsoleEventsFromConsoleProvider(this._protocolApi, this._domainsEnabler);
    private readonly _consoleEventsFromRuntimeProvider = new CDTPConsoleEventsFromRuntimeProvider(this._protocolApi, this._scriptsRegistry, this._domainsEnabler);

    public readonly onMessageAdded = (listener: onMessageAddedListener) => this._consoleEventsFromConsoleProvider.onMessageAdded(listener);
    public readonly onConsoleAPICalled = (listener: onConsoleAPICalled) => this._consoleEventsFromRuntimeProvider.onConsoleAPICalled(listener);

    constructor(
        @inject(TYPES.CDTPClient) private readonly _protocolApi: CDTP.ProtocolApi,
        @inject(TYPES.CDTPScriptsRegistry) private _scriptsRegistry: CDTPScriptsRegistry,
        @inject(TYPES.IDomainsEnabler) private readonly _domainsEnabler: CDTPDomainsEnabler,
    ) {
    }
}
