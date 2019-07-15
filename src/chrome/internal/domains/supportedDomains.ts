/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IInstallableComponent } from '../features/components';
import { Protocol as CDTP } from 'devtools-protocol';

import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { CDTPSchemaProvider } from '../../cdtpDebuggee/features/cdtpSchemaProvider';
import { DoNotLog } from '../../logging/decorators';

export interface ISupportedDomains extends IInstallableComponent {
    isSupported(domainName: string): boolean;
}

@injectable()
export class SupportedDomains implements ISupportedDomains {
    private readonly _domains = new Map<string, CDTP.Schema.Domain>();

    constructor(@inject(TYPES.ISchemaProvider) private readonly _cdtpSchemaProvider: CDTPSchemaProvider) { }

    @DoNotLog()
    public isSupported(domainName: string): boolean {
        return this._domains.has(domainName);
    }

    public async install(): Promise<this> {
        await this.initSupportedDomains();
        return this;
    }

    private async initSupportedDomains(): Promise<void> {
        try {
            const domains = await this._cdtpSchemaProvider.getDomains();
            domains.forEach(domain => this._domains.set(domain.name, domain));
        } catch (e) {
            // If getDomains isn't supported for some reason, skip this
        }
    }
}