import { Listeners } from './listeners';
import { PromiseOrNot } from '../utils/promises';

export class TransformedListener<O, T> {
    private readonly _transformedListeners = new Listeners<T, void>();

    public registerListener(transformedListener: (params: T) => void) {
        this._transformedListeners.add(transformedListener);
    }

    constructor(
        registerOriginalListener: (originalListener: (originalParameters: O) => void) => void,
        transformation: (originalParameters: O) => PromiseOrNot<T>) {
        registerOriginalListener(async originalParameters => {
            const transformedParameters = await transformation(originalParameters);
            return this._transformedListeners.call(transformedParameters);
        });
    }
}
