import { HandlesRegistry } from './handlesRegistry';
import { LoadedSourceCallFrame, CallFrameWithState } from '../internal/stackTraces/callFrame';
import { CallFramePresentation } from '../internal/stackTraces/callFramePresentation';
import { isDefined } from '../utils/typedOperators';
import { injectable } from 'inversify';

@injectable()
export class FrameParser {
    public constructor(private readonly _handlesRegistry: HandlesRegistry) { }

    public optionalFrameById(frameId: number | undefined): LoadedSourceCallFrame<CallFrameWithState> | undefined {
        return isDefined(frameId)
            ? this.frameById(frameId)
            : undefined;
    }

    public frameById(frameId: number): LoadedSourceCallFrame<CallFrameWithState> | undefined {
        const stackTrace = this._handlesRegistry.frames.getObjectById(frameId);
        if (stackTrace instanceof CallFramePresentation && stackTrace.callFrame.hasState()) {
            return stackTrace.callFrame;
        } else {
            return undefined;
        }
    }
}