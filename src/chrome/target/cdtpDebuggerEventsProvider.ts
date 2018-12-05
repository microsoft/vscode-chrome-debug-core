import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { Crdp } from '../..';
import { asyncMap } from '../collections/async';
import { PausedEvent } from './events';
import { TargetToInternal } from './targetToInternal';

export class CDTPDebuggerEventsProvider extends CDTPEventsEmitterDiagnosticsModule<Crdp.DebuggerApi> {
    public readonly onPaused = this.addApiListener('paused', async (params: Crdp.Debugger.PausedEvent) => {
        if (params.callFrames.length === 0) {
            throw new Error(`Expected a pause event to have at least a single call frame: ${JSON.stringify(params)}`);
        }

        const callFrames = await asyncMap(params.callFrames, (callFrame, index) => this._crdpToInternal.toCallFrame(index, callFrame));
        return new PausedEvent(callFrames, params.reason, params.data,
            this._crdpToInternal.getBPsFromIDs(params.hitBreakpoints),
            params.asyncStackTrace && await this._crdpToInternal.toStackTraceCodeFlow(params.asyncStackTrace),
            params.asyncStackTraceId, params.asyncCallStackTraceId);
    });

    public readonly onResumed = this.addApiListener('resumed', (params: void) => params);

    public readonly onScriptFailedToParse = this.addApiListener('resumed', (params: Crdp.Debugger.ScriptFailedToParseEvent) => params);

    constructor(
        protected readonly api: Crdp.DebuggerApi,
        private readonly _crdpToInternal: TargetToInternal) {
        super();
    }
}