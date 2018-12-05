import { IScript } from '../internal/scripts/script';
import { Crdp } from '../..';
import { ScriptOrSource } from '../internal/locations/location';
import { ValidatedMap } from '../collections/validatedMap';
import { ICallFrame } from '../internal/stackTraces/callFrame';

export class InternalToTarget {
    private nextEvaluateScriptId = 0;

    public getFrameId(frame: ICallFrame<ScriptOrSource>): Crdp.Debugger.CallFrameId {
        return this._callFrameToId.get(frame.unmappedCallFrame);
    }

    public addURLIfMissing(expression: string): string {
        const sourceUrlPrefix = '\n//# sourceURL=';

        if (expression.indexOf(sourceUrlPrefix) < 0) {
            expression += `${sourceUrlPrefix}<debugger-internal>/id=${this.nextEvaluateScriptId++}`;
        }

        return expression;
    }

    constructor(
        private readonly _callFrameToId: ValidatedMap<ICallFrame<IScript>, Crdp.Debugger.CallFrameId>) { }
}