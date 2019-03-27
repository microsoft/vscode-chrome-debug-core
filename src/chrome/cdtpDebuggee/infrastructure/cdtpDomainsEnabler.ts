/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { IEnableableApi } from './cdtpDiagnosticsModule';
import { Protocol as CDTP } from 'devtools-protocol';
import { TYPES } from '../../dependencyInjection.ts/types';
import { inject, injectable } from 'inversify';
import * as utils from '../../../utils';
import { asyncMap } from '../../collections/async';
import { ValidatedMap } from '../../collections/validatedMap';
import * as _ from 'lodash';

export interface IDomainsEnabler {
    registerToEnable<T extends IEnableableApi<EnableParameters, EnableResponse>, EnableParameters, EnableResponse>
        (api: T, parameters: EnableParameters): Promise<EnableResponse>;

    enableDomains(): Promise<void>;
}

interface IState {
    registerToEnable<T extends IEnableableApi<EnableParameters, EnableResponse>, EnableParameters, EnableResponse>
        (api: T, parameters: EnableParameters): Promise<EnableResponse>;
    enableDomains(): Promise<IState>;
}

class EnableDomainFunctionAndResultPromise<EnableResponse> {
    constructor(
        public readonly enableDomain: () => Promise<EnableResponse>,
        public readonly parameters: unknown,
        public readonly defer: utils.IPromiseDefer<EnableResponse>,
    ) { }
}

class GatheringDomainsToEnableDuringStartup implements IState {
    private readonly _registeredDomains = new ValidatedMap<IEnableableApi<unknown, unknown>, EnableDomainFunctionAndResultPromise<any>>();

    constructor(@inject(TYPES.CDTPClient) protected readonly protocolApi: CDTP.ProtocolApi) { }

    public async enableDomains(): Promise<IState> {
        const entries = Array.from(this._registeredDomains.entries());
        await asyncMap(entries, async pair => this.executeEnable(pair[0], pair[1]));
        return new DomainsAlreadyEnabledAfterStartup();
    }

    public async executeEnable(domain: IEnableableApi<unknown, unknown>, extras: EnableDomainFunctionAndResultPromise<any>): Promise<void> {
        await this.verifyPrerequisitesAreMet(domain);

        try {
            extras.defer.resolve(extras.enableDomain());
        } catch (exception) {
            extras.defer.reject(exception);
        }
    }

    public async verifyPrerequisitesAreMet(domain: IEnableableApi<unknown, unknown>): Promise<void> {
        if (domain !== this.protocolApi.Runtime) {
            // TODO: For the time being we assume that all domains require the Runtime domain to be enabled. Figure out if this can be improved
            await this._registeredDomains.get(this.protocolApi.Runtime).defer.promise;
        }
    }

    public async registerToEnable<T extends IEnableableApi<EnableParameters, EnableResponse>, EnableParameters, EnableResponse>
        (api: T, parameters: EnableParameters): Promise<EnableResponse> {
        const enableDomain = () => api.enable(parameters);

        const entry = this._registeredDomains.getOrAdd(api, () =>
            new EnableDomainFunctionAndResultPromise(enableDomain, parameters, utils.promiseDefer<EnableResponse>()));

        if (entry.parameters !== parameters) {
            throw new Error(`Cannot register enable(${parameters}) for domain ${this.getDomainName(api)} because it was registered previously with enable(${entry.parameters})`);
        }

        return await entry.defer.promise;
    }

    private getDomainName(api: IEnableableApi<unknown, unknown>): string {
        const name = _.findKey(this.protocolApi, api);
        if (name !== undefined) {
            return name;
        } else {
            throw new Error(`Couldn't get the domain name for ${api}`);
        }
    }
}

class DomainsAlreadyEnabledAfterStartup implements IState {
    public registerToEnable<T extends IEnableableApi<EnableParameters, EnableResponse>, EnableParameters, EnableResponse>
        (api: T, parameters: EnableParameters): Promise<EnableResponse> {
        return api.enable(parameters);
    }

    public enableDomains(): Promise<IState> {
        throw new Error('Startup was already finished');
    }
}

@injectable()
export class CDTPDomainsEnabler implements IDomainsEnabler {
    private _state: IState = new GatheringDomainsToEnableDuringStartup(this._protocolApi);

    constructor(@inject(TYPES.CDTPClient) private readonly _protocolApi: CDTP.ProtocolApi) { }

    public registerToEnable<T extends IEnableableApi<EnableParameters, EnableResponse>, EnableParameters, EnableResponse>
        (api: T, parameters?: EnableParameters): Promise<EnableResponse> {
        return this._state.registerToEnable(api, parameters);
    }

    public async enableDomains(): Promise<void> {
        this._state = await this._state.enableDomains();
    }
}