/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { Protocol as CDTP } from 'devtools-protocol';
import { ValidatedMap } from '../../collections/validatedMap';
import { ScriptCallFrame } from '../../internal/stackTraces/callFrame';
import { injectable } from 'inversify';

@injectable()
export class CDTPCallFrameRegistry {
    private readonly _callFrameToId = new ValidatedMap<ScriptCallFrame, CDTP.Debugger.CallFrameId>();

    public registerFrameId(callFrameId: CDTP.Debugger.CallFrameId, frame: ScriptCallFrame): void {
        this._callFrameToId.set(frame, callFrameId);
    }

    public getFrameId(frame: ScriptCallFrame): CDTP.Debugger.CallFrameId {
        return this._callFrameToId.get(frame);
    }
}