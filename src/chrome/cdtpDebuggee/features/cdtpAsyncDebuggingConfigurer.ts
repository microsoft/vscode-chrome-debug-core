/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface IAsyncDebuggingConfigurer {
    setAsyncCallStackDepth(maxDepth: CDTP.integer): Promise<void>;
}

@injectable()
export class CDTPAsyncDebuggingConfigurer implements IAsyncDebuggingConfigurer {
    protected readonly api = this._protocolApi.Debugger;

    constructor(
        @inject(TYPES.CDTPClient)
        private readonly _protocolApi: CDTP.ProtocolApi) {
    }

    public setAsyncCallStackDepth(maxDepth: CDTP.integer): Promise<void> {
        return this.api.setAsyncCallStackDepth({ maxDepth });
    }
}
