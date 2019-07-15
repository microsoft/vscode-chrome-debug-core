/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface INetworkCacheConfigurer {
    setCacheDisabled(params: CDTP.Network.SetCacheDisabledRequest): Promise<void>;
}

@injectable()
export class CDTPNetworkCacheConfigurer implements INetworkCacheConfigurer {
    private _api: CDTP.NetworkApi = this._protocolApi.Network;

    constructor(@inject(TYPES.CDTPClient) private readonly _protocolApi: CDTP.ProtocolApi) {}

    public enable(parameters: CDTP.Network.EnableRequest): Promise<void> {
        return this._api.enable(parameters);
    }

    public disable(): Promise<void> {
        return this._api.disable();
    }

    public setCacheDisabled(params: CDTP.Network.SetCacheDisabledRequest): Promise<void> {
        return this._api.setCacheDisabled(params);
    }
}
