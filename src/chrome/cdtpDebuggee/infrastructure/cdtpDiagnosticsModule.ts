/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { TransformedListenerRegistry } from '../../communication/transformedListenerRegistry';
import { PromiseOrNot } from '../../utils/promises';
import { injectable } from 'inversify';
import { CDTPDomainsEnabler } from './cdtpDomainsEnabler';

export interface IEnableableApi<EnableParameters = void, EnableResponse = void> {
    enable(parameters: EnableParameters): Promise<EnableResponse>;
    on(eventName: string, listener: Function): void;
}

@injectable()
export abstract class CDTPEnableableDiagnosticsModule<T extends IEnableableApi<EnableParameters, EnableResponse>, EnableParameters = void, EnableResponse = void> {
    protected abstract get api(): T;

    public enable(): EnableParameters extends void ? Promise<EnableResponse> : never;
    public enable(parameters: EnableParameters): Promise<EnableResponse>;
    public async enable(parameters?: EnableParameters): Promise<EnableResponse> {
        return await this._domainsEnabler.registerToEnable<T, EnableParameters, EnableResponse>(this.api, parameters);
    }

    constructor(private readonly _domainsEnabler: CDTPDomainsEnabler) { }
}

@injectable()
export abstract class CDTPEventsEmitterDiagnosticsModule<T extends {} & IEnableableApi<EnableParameters, EnableResponse>, EnableParameters = void, EnableResponse = void>
    extends CDTPEnableableDiagnosticsModule<T, EnableParameters, EnableResponse> {
    public addApiListener<O, T>(eventName: string, transformation: (params: O) => PromiseOrNot<T>): (transformedListener: ((params: T) => void)) => void {

        const transformedListenerRegistryPromise = new TransformedListenerRegistry<O, T>(this.constructor.name, async originalListener => {
            this.api.on(eventName, originalListener);
        }, transformation).install();

        this.enable(); // The domain will be enabled eventually (Assuming this happens during the startup/initial configuration phase). We don't block on it.

        return async transformedListener => (await transformedListenerRegistryPromise).registerListener(transformedListener);
    }
}