/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { Protocol as CDTP } from 'devtools-protocol';
import { IScript } from '../../internal/scripts/script';
import { CDTPScriptsRegistry } from '../registries/cdtpScriptsRegistry';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface IScriptSourcesRetriever {
    getScriptSource(script: IScript): Promise<string>;
}

@injectable()
export class CDTPScriptSourcesRetriever implements IScriptSourcesRetriever {
    protected readonly api = this._protocolApi.Debugger;

    constructor(
        @inject(TYPES.CDTPClient)
        private readonly _protocolApi: CDTP.ProtocolApi,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) {
    }

    public async getScriptSource(script: IScript): Promise<string> {
        return (await this.api.getScriptSource({ scriptId: this._scriptsRegistry.getCdtpId(script) })).scriptSource;
    }
}
