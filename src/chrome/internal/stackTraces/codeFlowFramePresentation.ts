import { ILoadedSource } from '../sources/loadedSource';
import { CodeFlowFrame } from './callFrame';
import { StackTracePresentationRow, CallFramePresentationHint } from './stackTracePresentationRow';
import { FramePresentationCommonLogic, CallFramePresentation, ICallFramePresentationDetails } from './callFramePresentation';

export class CodeFlowFramePresentation extends FramePresentationCommonLogic implements StackTracePresentationRow {
    constructor(public readonly codeFlow: CodeFlowFrame<ILoadedSource>, additionalPresentationDetails?: ICallFramePresentationDetails, presentationHint?: CallFramePresentationHint) {
        super(additionalPresentationDetails, presentationHint);
    }

    public get description(): string {
        return this.codeFlow.functionDescription;
    }

    public isCallFrame(): this is CallFramePresentation {
        return false;
    }
}
