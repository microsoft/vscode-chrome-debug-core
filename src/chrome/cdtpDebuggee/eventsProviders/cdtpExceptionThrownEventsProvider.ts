/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';

import { CDTPEventsEmitterDiagnosticsModule } from '../infrastructure/cdtpDiagnosticsModule';
import { CDTPStackTraceParser } from '../protocolParsers/cdtpStackTraceParser';
import { CDTPScriptsRegistry } from '../registries/cdtpScriptsRegistry';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { integer } from '../cdtpPrimitives';
import { IScript } from '../../internal/scripts/script';
import { CodeFlowStackTrace } from '../../internal/stackTraces/codeFlowStackTrace';
import { CDTPDomainsEnabler } from '../infrastructure/cdtpDomainsEnabler';
import { isDefined, isNotEmpty } from '../../utils/typedOperators';

export interface IExceptionThrownEvent {
    readonly timestamp: CDTP.Runtime.Timestamp;
    readonly exceptionDetails: IExceptionDetails;
}

export interface IExceptionDetails {
    readonly exceptionId: integer;
    readonly text: string;
    readonly lineNumber: integer;
    readonly columnNumber: integer;
    readonly script?: IScript;
    readonly url?: string;
    readonly stackTrace?: CodeFlowStackTrace;
    readonly exception?: CDTP.Runtime.RemoteObject;
    readonly executionContextId?: CDTP.Runtime.ExecutionContextId;
}

export interface IExceptionThrownEventProvider {
    onExceptionThrown(listener: (event: IExceptionThrownEvent) => void): void;
}

@injectable()
export class CDTPExceptionThrownEventsProvider extends CDTPEventsEmitterDiagnosticsModule<CDTP.RuntimeApi> implements IExceptionThrownEventProvider {
    protected readonly api = this.protocolApi.Runtime;

    private readonly _stackTraceParser = new CDTPStackTraceParser(this._scriptsRegistry);

    public readonly onExceptionThrown = this.addApiListener('exceptionThrown', async (params: CDTP.Runtime.ExceptionThrownEvent) =>
        ({
            timestamp: params.timestamp,
            exceptionDetails: await this.toExceptionDetails(params.exceptionDetails)
        }));

    constructor(
        @inject(TYPES.CDTPClient) private readonly protocolApi: CDTP.ProtocolApi,
        @inject(TYPES.CDTPScriptsRegistry) private _scriptsRegistry: CDTPScriptsRegistry,
        @inject(TYPES.IDomainsEnabler) domainsEnabler: CDTPDomainsEnabler,
    ) {
        super(domainsEnabler);
    }

    private async toExceptionDetails(exceptionDetails: CDTP.Runtime.ExceptionDetails): Promise<IExceptionDetails> {
        return {
            exceptionId: exceptionDetails.exceptionId,
            text: exceptionDetails.text,
            lineNumber: exceptionDetails.lineNumber,
            columnNumber: exceptionDetails.columnNumber,
            script: isNotEmpty(exceptionDetails.scriptId) ? await this._scriptsRegistry.getScriptByCdtpId(exceptionDetails.scriptId) : undefined,
            url: exceptionDetails.url,
            stackTrace: isDefined(exceptionDetails.stackTrace) ? await this._stackTraceParser.toStackTraceCodeFlow(exceptionDetails.stackTrace) : undefined,
            exception: exceptionDetails.exception,
            executionContextId: exceptionDetails.executionContextId,
        };
    }
}