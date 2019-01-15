import { ICodeFlowFramePresentation, CallFramePresentation } from './callFramePresentation';

export type CallFramePresentationHint = 'normal' | 'label' | 'subtle';

// Row of a stack trace that we send to the client
export interface StackTracePresentationRow {
    readonly presentationHint?: CallFramePresentationHint;
    isNotLabel(): this is ICodeFlowFramePresentation;
    isCallFrame(): this is CallFramePresentation;
}

// Row of a stack trace that is a label e.g.: [Show more frames] or [Frames skipped by smartStep], etc...
export class StackTraceLabel implements StackTracePresentationRow {
    public readonly presentationHint = 'label';

    public isCallFrame(): this is CallFramePresentation {
        return false;
    }

    public isNotLabel(): this is ICodeFlowFramePresentation {
        return false;
    }

    constructor(public readonly description: string) { }
}
