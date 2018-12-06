import { IScript } from '../internal/scripts/script';
import { Crdp } from '../..';
import { ScriptOrSource } from '../internal/locations/location';
import { ValidatedMap } from '../collections/validatedMap';
import { ICallFrame } from '../internal/stackTraces/callFrame';

export class CallFrameRegistry {
    public getFrameId(frame: ICallFrame<ScriptOrSource>): Crdp.Debugger.CallFrameId {
        return this._callFrameToId.get(frame.unmappedCallFrame);
    }

    constructor(
        private readonly _callFrameToId: ValidatedMap<ICallFrame<IScript>, Crdp.Debugger.CallFrameId>) { }
}