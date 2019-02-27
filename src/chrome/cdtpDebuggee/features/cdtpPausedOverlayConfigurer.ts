/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { CDTPEnableableDiagnosticsModule } from '../infrastructure/cdtpDiagnosticsModule';
import { Protocol as CDTP } from 'devtools-protocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { inject } from 'inversify';
import { CDTPDomainsEnabler } from '../infrastructure/cdtpDomainsEnabler';

export interface IPausedOverlayConfigurer {
    setPausedInDebuggerMessage(params: CDTP.Overlay.SetPausedInDebuggerMessageRequest): Promise<void>;
}

// TODO: Move this to a browser shared package
export class CDTPPausedOverlayConfigurer extends CDTPEnableableDiagnosticsModule<CDTP.OverlayApi> implements IPausedOverlayConfigurer {
    protected readonly api = this._protocolApi.Overlay;

    constructor(
        @inject(TYPES.CDTPClient) private readonly _protocolApi: CDTP.ProtocolApi,
        @inject(TYPES.IDomainsEnabler) domainsEnabler: CDTPDomainsEnabler, ) {
        super(domainsEnabler);
    }

    public setPausedInDebuggerMessage(params: CDTP.Overlay.SetPausedInDebuggerMessageRequest): Promise<void> {
        return this.api.setPausedInDebuggerMessage(params);
    }
}
