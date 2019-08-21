/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { Protocol as CDTP } from 'devtools-protocol';
import { IScript } from '../../internal/scripts/script';
import { CDTPScriptsRegistry } from '../registries/cdtpScriptsRegistry';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { SourceContents } from '../../internal/sources/sourceContents';

export interface IScriptSourcesRetriever {
    getScriptSource(script: IScript): Promise<SourceContents>;
}

@injectable()
export class CDTPScriptSourcesRetriever implements IScriptSourcesRetriever {
    protected readonly api = this._protocolApi.Debugger;

    constructor(
        @inject(TYPES.CDTPClient)
        private readonly _protocolApi: CDTP.ProtocolApi,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) {
    }

    public async getScriptSource(script: IScript): Promise<SourceContents> {
        const scriptSource = (await this.api.getScriptSource({ scriptId: this._scriptsRegistry.getCdtpId(script) })).scriptSource;
        return SourceContents.customerContent(scriptSource);
    }
}
