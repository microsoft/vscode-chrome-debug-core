import { ScriptOrSource, Location } from '../locations/location';

import { ILoadedSource } from '../sources/loadedSource';

import { CodeFlowFrame, ICallFrame } from './callFrame';

import { CodeFlowFramePresentationRow } from './stackTracePresentation';

export type SourcePresentationHint = 'normal' | 'emphasize' | 'deemphasize';
export type CallFramePresentationHint = 'normal' | 'label' | 'subtle';

export interface ICallFramePresentationDetails {
    readonly additionalSourceOrigins: string[];
    readonly sourcePresentationHint: SourcePresentationHint;
}

export interface ICodeFlowFramePresentation<TResource extends ScriptOrSource> extends CodeFlowFramePresentationRow<TResource> {
    readonly name: string;
    readonly source: ILoadedSource;
    readonly location: NonNullable<Location<TResource>>;
    readonly lineNumber: NonNullable<number>;
    readonly columnNumber: number;
}

export abstract class CodeFlowFramePresentationCommonLogic<TResource extends ScriptOrSource> implements ICodeFlowFramePresentation<TResource> {
    public abstract get codeFlow(): NonNullable<CodeFlowFrame<TResource>>;
    public abstract hasCallFrame(): this is CallFramePresentation<TResource>;

    public get name(): string {
        return this.codeFlow.name;
    }

    public get source(): ILoadedSource {
        return this.codeFlow.source;
    }

    public get location(): NonNullable<Location<TResource>> {
        return this.codeFlow.location;
    }

    public get lineNumber(): NonNullable<number> {
        return this.codeFlow.lineNumber;
    }

    public get columnNumber(): number {
        return this.codeFlow.columnNumber;
    }

    public hasCodeFlow(): this is ICodeFlowFramePresentation<TResource> {
        return true;
    }

    constructor(
        public readonly additionalPresentationDetails?: ICallFramePresentationDetails,
        public readonly presentationHint?: CallFramePresentationHint) { }
}

export class CallFramePresentation<TResource extends ScriptOrSource> extends CodeFlowFramePresentationCommonLogic<TResource> implements CodeFlowFramePresentationRow<TResource> {
    public get codeFlow(): CodeFlowFrame<TResource> {
        return this.callFrame.codeFlow;
    }

    public hasCallFrame(): this is CallFramePresentation<TResource> {
        return true;
    }

    constructor(
        public readonly callFrame: NonNullable<ICallFrame<TResource>>,
        additionalPresentationDetails?: ICallFramePresentationDetails,
        presentationHint?: CallFramePresentationHint) {
        super(additionalPresentationDetails, presentationHint);
    }
}

export class CodeFlowFramePresentation<TResource extends ScriptOrSource> extends CodeFlowFramePresentationCommonLogic<TResource> implements CodeFlowFramePresentationRow<TResource> {
    public hasCallFrame(): this is CallFramePresentation<TResource> {
        return false;
    }

    constructor(
        public readonly codeFlow: NonNullable<CodeFlowFrame<TResource>>,
        additionalPresentationDetails?: ICallFramePresentationDetails,
        presentationHint?: CallFramePresentationHint) {
        super(additionalPresentationDetails, presentationHint);
    }
}
