import { IScript } from '../internal/scripts/script';
import { Crdp } from '../..';
import { LocationInScript, ScriptOrSource, ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { ValidatedMap } from '../collections/validatedMap';
import { IBPRecipie, BPRecipie } from '../internal/breakpoints/bpRecipie';
import { AlwaysBreak, ConditionalBreak } from '../internal/breakpoints/bpActionWhenHit';
import { BreakpointIdRegistry } from './breakpointIdRegistry';
import { ICallFrame } from '../internal/stackTraces/callFrame';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';

export class InternalToTarget {
    private nextEvaluateScriptId = 0;

    public getBPRecipieCondition(bpRecipie: IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp, AlwaysBreak | ConditionalBreak>): string | undefined {
        return bpRecipie.bpActionWhenHit.basedOnTypeDo({
            alwaysBreak: () => undefined,
            conditionalBreak: conditionalBreak => conditionalBreak.expressionOfWhenToBreak
        });
    }

    public getBreakpointId(bpRecipie: BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>): Crdp.Debugger.BreakpointId {
        return this._breakpointIdRegistry.getBreakpointId(bpRecipie);
    }

    public getFrameId(frame: ICallFrame<ScriptOrSource>): Crdp.Debugger.CallFrameId {
        return this._callFrameToId.get(frame.unmappedCallFrame);
    }

    public getScriptId(script: IScript): Crdp.Runtime.ScriptId {
        return this._scriptsRegistry.getCrdpId(script);
    }

    public toCrdpLocation(location: LocationInScript): Crdp.Debugger.Location {
        return {
            scriptId: this.getScriptId(location.script),
            lineNumber: location.lineNumber,
            columnNumber: location.columnNumber
        };
    }

    public addURLIfMissing(expression: string): string {
        const sourceUrlPrefix = '\n//# sourceURL=';

        if (expression.indexOf(sourceUrlPrefix) < 0) {
            expression += `${sourceUrlPrefix}<debugger-internal>/id=${this.nextEvaluateScriptId++}`;
        }

        return expression;
    }

    constructor(
        private readonly _scriptsRegistry: CDTPScriptsRegistry,
        private readonly _callFrameToId: ValidatedMap<ICallFrame<IScript>, Crdp.Debugger.CallFrameId>,
        private readonly _breakpointIdRegistry: BreakpointIdRegistry) { }
}