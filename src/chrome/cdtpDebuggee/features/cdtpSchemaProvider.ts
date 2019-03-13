/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
export interface ISchemaProvider {
    getDomains(): Promise<CDTP.Schema.Domain[]>;
}

export class CDTPSchemaProvider {
    constructor(protected api: CDTP.SchemaApi) { }

    public async getDomains(): Promise<CDTP.Schema.Domain[]> {
        return (await this.api.getDomains()).domains;
    }
}
