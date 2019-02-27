/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';

export interface INetworkCacheConfigurer {
    setCacheDisabled(params: CDTP.Network.SetCacheDisabledRequest): Promise<void>;
}

export class CDTPNetworkCacheConfigurer implements INetworkCacheConfigurer {
    constructor(protected api: CDTP.NetworkApi) {
    }

    public enable(parameters: CDTP.Network.EnableRequest): Promise<void> {
        return this.api.enable(parameters);
    }

    public disable(): Promise<void> {
        return this.api.disable();
    }

    public setCacheDisabled(params: CDTP.Network.SetCacheDisabledRequest): Promise<void> {
        return this.api.setCacheDisabled(params);
    }
}
