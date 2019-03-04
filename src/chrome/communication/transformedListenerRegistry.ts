/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Listeners } from './listeners';
import { PromiseOrNot } from '../utils/promises';

export class TransformedListenerRegistry<O, T> {
    private readonly _transformedListeners = new Listeners<T, void>();

    constructor(
        public readonly _description: string, // This description is only used for debugging purposes
        private readonly _registerOriginalListener: (originalListener: (originalParameters: O) => void) => PromiseOrNot<void>,
        private readonly _transformation: (originalParameters: O) => PromiseOrNot<T>) {
    }

    public registerListener(transformedListener: (params: T) => void) {
        this._transformedListeners.add(transformedListener);
    }

    public async install(): Promise<this> {
        await this._registerOriginalListener(async originalParameters => {
            const transformedParameters = await this._transformation(originalParameters);
            return this._transformedListeners.call(transformedParameters);
        });
        return this;
    }
}
