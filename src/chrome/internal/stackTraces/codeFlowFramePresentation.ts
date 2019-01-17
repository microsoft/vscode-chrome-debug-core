import { ILoadedSource } from '../sources/loadedSource';
import { CodeFlowFrame } from './callFrame';
import { IStackTracePresentationRow, CallFramePresentationHint } from './stackTracePresentationRow';
import { BaseFramePresentation, CallFramePresentation, ICallFramePresentationDetails } from './callFramePresentation';

export class CodeFlowFramePresentation extends BaseFramePresentation implements IStackTracePresentationRow {
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
