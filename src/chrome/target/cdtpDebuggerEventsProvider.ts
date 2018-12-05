import { CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { Crdp } from '../..';
import { asyncMap } from '../collections/async';
import { PausedEvent } from './events';
import { CDTPStackTraceParser } from './cdtpStackTraceParser';
import { adaptToSinglIntoToMulti } from '../../utils';
import { IBPRecipie } from '../internal/breakpoints/bpRecipie';
import { ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { BreakpointIdRegistry } from './breakpointIdRegistry';
import { ScriptCallFrame, ICallFrame, CodeFlowFrame } from '../internal/stackTraces/callFrame';
import { asyncUndefinedOnFailure } from '../utils/failures';
import { CDTPLocationParser } from './cdtpLocationParser';
import { Scope } from '../internal/stackTraces/scopes';
import { IScript } from '../internal/scripts/script';

export class CDTPDebuggerEventsProvider extends CDTPEventsEmitterDiagnosticsModule<Crdp.DebuggerApi> {
    private getBPsFromIDs = adaptToSinglIntoToMulti(this, this.getBPFromID);

    public readonly onPaused = this.addApiListener('paused', async (params: Crdp.Debugger.PausedEvent) => {
        if (params.callFrames.length === 0) {
            throw new Error(`Expected a pause event to have at least a single call frame: ${JSON.stringify(params)}`);
        }

        const callFrames = await asyncMap(params.callFrames, (callFrame, index) => this.toCallFrame(index, callFrame));
        return new PausedEvent(callFrames, params.reason, params.data,
            this.getBPsFromIDs(params.hitBreakpoints),
            params.asyncStackTrace && await this._crdpToInternal.toStackTraceCodeFlow(params.asyncStackTrace),
            params.asyncStackTraceId, params.asyncCallStackTraceId);
    });

    public readonly onResumed = this.addApiListener('resumed', (params: void) => params);

    public readonly onScriptFailedToParse = this.addApiListener('resumed', (params: Crdp.Debugger.ScriptFailedToParseEvent) => params);

    private getBPFromID(hitBreakpoint: Crdp.Debugger.BreakpointId): IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp> {
        return this._breakpointIdRegistry.getRecipieByBreakpointId(hitBreakpoint);
    }

    private async toCallFrame(index: number, callFrame: Crdp.Debugger.CallFrame): Promise<ICallFrame<IScript>> {
        return new ScriptCallFrame(await this.DebuggertoCallFrameCodeFlow(index, callFrame),
            await Promise.all(callFrame.scopeChain.map(scope => this.toScope(scope))),
            callFrame.this, callFrame.returnValue);
    }

    private DebuggertoCallFrameCodeFlow(index: number, callFrame: Crdp.Debugger.CallFrame): Promise<CodeFlowFrame<IScript>> {
        return this._crdpToInternal.configurableToCallFrameCodeFlow(index, callFrame, callFrame.location);
    }

    private async toScope(scope: Crdp.Debugger.Scope): Promise<Scope> {
        return {
            type: scope.type,
            object: scope.object,
            name: scope.name,
            // TODO FILE BUG: Chrome sometimes returns line -1 when the doc says it's 0 based
            startLocation: await asyncUndefinedOnFailure(async () => scope.startLocation && await this._cdtpLocationParser.getScriptLocation(scope.startLocation)),
            endLocation: await asyncUndefinedOnFailure(async () => scope.endLocation && await this._cdtpLocationParser.getScriptLocation(scope.endLocation))
        };
    }

    constructor(
        protected readonly api: Crdp.DebuggerApi,
        private readonly _crdpToInternal: CDTPStackTraceParser,
        private readonly _breakpointIdRegistry: BreakpointIdRegistry,
        private readonly _cdtpLocationParser: CDTPLocationParser) {
        super();
    }
}