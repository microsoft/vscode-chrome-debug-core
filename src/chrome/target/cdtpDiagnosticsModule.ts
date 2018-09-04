import { TransformedListener } from '../communication/transformedListener';
import { PromiseOrNot } from '../utils/promises';

export abstract class CDTPDiagnosticsModule<T> {
    protected abstract get api(): T;
}

export abstract class CDTPEventsEmitterDiagnosticsModule<T extends { on(eventName: string, listener: Function): void; }> extends CDTPDiagnosticsModule<T> {
    addApiListener<O, T>(eventName: string, transformation: (params: O) => PromiseOrNot<T>): (transformedListener: ((params: T) => void)) => void {
        return transformedListener => new TransformedListener<O, T>(originalListener => {
            this.addApiListener(eventName, originalListener);
        }, transformation).registerListener(transformedListener);
    }
}