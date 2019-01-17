import { Location } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { CodeFlowFrame, ICallFrame, CallFrame } from './callFrame';
import { IStackTracePresentationRow, CallFramePresentationHint } from './stackTracePresentationRow';
import { ICallFrameDescriptionFormatter } from './callFrameDescription';

export type SourcePresentationHint = 'normal' | 'emphasize' | 'deemphasize';

export interface ICallFramePresentationDetails {
    readonly additionalSourceOrigins: string[];
    readonly sourcePresentationHint: SourcePresentationHint;
}

export interface ICodeFlowFramePresentation extends IStackTracePresentationRow {
    readonly description: string;
    readonly source: ILoadedSource;
    readonly location: Location<ILoadedSource>;
    readonly lineNumber: number;
    readonly columnNumber: number;
    readonly codeFlow: CodeFlowFrame<ILoadedSource>;
}

export abstract class BaseFramePresentation implements ICodeFlowFramePresentation {
    constructor(
        public readonly additionalPresentationDetails?: ICallFramePresentationDetails,
        public readonly presentationHint?: CallFramePresentationHint) { }

    public abstract get codeFlow(): CodeFlowFrame<ILoadedSource>;
    public abstract isCallFrame(): this is CallFramePresentation;
    public abstract get description(): string;

    public get source(): ILoadedSource {
        return this.codeFlow.source;
    }

    public get location(): Location<ILoadedSource> {
        return this.codeFlow.location;
    }

    public get lineNumber(): number {
        return this.codeFlow.lineNumber;
    }

    public get columnNumber(): number {
        return this.codeFlow.columnNumber;
    }

    public isCodeFlow(): this is ICodeFlowFramePresentation {
        return true;
    }
}

export class CallFramePresentation extends BaseFramePresentation implements IStackTracePresentationRow {
    constructor(
        public readonly callFrame: CallFrame<ILoadedSource>,
        private readonly _descriptionFormatter: ICallFrameDescriptionFormatter,
        additionalPresentationDetails?: ICallFramePresentationDetails,
        presentationHint?: CallFramePresentationHint) {
        super(additionalPresentationDetails, presentationHint);
    }

    public get codeFlow(): CodeFlowFrame<ILoadedSource> {
        return (<ICallFrame<ILoadedSource>>this.callFrame).codeFlow; // TODO: Figure out how to remove the cast
    }

    public isCallFrame(): this is CallFramePresentation {
        return true;
    }

    public get description(): string {
        return this._descriptionFormatter.description;
    }
}

export class CodeFlowFramePresentation extends BaseFramePresentation implements IStackTracePresentationRow {
    constructor(
        public readonly codeFlow: CodeFlowFrame<ILoadedSource>,
        additionalPresentationDetails?: ICallFramePresentationDetails,
        presentationHint?: CallFramePresentationHint) {
        super(additionalPresentationDetails, presentationHint);
    }

    public get description(): string {
        return this.codeFlow.functionDescription;
    }

    public isCallFrame(): this is CallFramePresentation {
        return false;
    }
}
