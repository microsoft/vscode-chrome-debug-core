/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
export interface ISchemaProvider {
    getDomains(): Promise<CDTP.Schema.Domain[]>;
}

@injectable()
export class CDTPSchemaProvider implements ISchemaProvider {
    constructor(@inject(TYPES.CDTPClient) protected api: CDTP.ProtocolApi) { }

    public async getDomains(): Promise<CDTP.Schema.Domain[]> {
        return (await this.api.Schema.getDomains()).domains;
    }
}
