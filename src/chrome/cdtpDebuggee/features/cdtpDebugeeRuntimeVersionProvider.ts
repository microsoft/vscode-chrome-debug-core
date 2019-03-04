/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';

import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { Version } from '../../utils/Version';
import * as _ from 'lodash';

export interface CDTPComponentsVersions {
    product: string;
    crdp: string;
    revision: string;
    userAgent: string;
    v8: string;
}

export interface IDebugeeRuntimeVersionProvider {
    version(): Promise<Version>;
    componentVersions(): Promise<CDTPComponentsVersions>;
}

/**
 * TODO: Move this to a browser-shared package
 * TODO: Update this so we automatically try to use ChromeConnection.version first, and then fallback to this if neccesary
 */
@injectable()
export class CDTPDebugeeRuntimeVersionProvider implements IDebugeeRuntimeVersionProvider {
    protected api = this._protocolApi.Browser;
    private readonly _componentsVersions = _.memoize(() => this.api.getVersion());

    constructor(
        @inject(TYPES.CDTPClient)
        protected _protocolApi: CDTP.ProtocolApi) {
    }

    public async version(): Promise<Version> {
        return Version.coerce((await this._componentsVersions()).product);
    }

    public async componentVersions(): Promise<CDTPComponentsVersions> {
        const rawComponentVersions = await this._componentsVersions();
        return {
            product: rawComponentVersions.product,
            revision: rawComponentVersions.revision,
            crdp: rawComponentVersions.protocolVersion,
            v8: rawComponentVersions.jsVersion,
            userAgent: rawComponentVersions.userAgent
        };
    }
}
