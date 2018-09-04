import { IScript } from './scripts/script';
import { ILoadedSource } from './sources/loadedSource';
import { ICallFrame } from './stackTraces/callFrame';

export interface EvaluateArguments {
    readonly expression: string;
    readonly frame?: ICallFrame<ILoadedSource>;
    readonly context?: string;
    readonly format?: {
        /** Display the value in hex. */
        readonly hex?: boolean;
    };
}

export interface CompletionsArguments {
    readonly frame?: ICallFrame<IScript>;
    readonly text: string;
    readonly column: number;
    readonly line?: number;
}
