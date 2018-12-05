import { Crdp, } from '../..';
import { IScript, } from '../internal/scripts/script';
import { LocationInScript, Coordinates, ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { asyncUndefinedOnFailure } from '../utils/failures';
import { CDTPScriptUrl } from '../internal/sources/resourceIdentifierSubtypes';
import { URLRegexp, IBPRecipie } from '../internal/breakpoints/bpRecipie';
import { BreakpointIdRegistry } from './breakpointIdRegistry';
import { CodeFlowStackTrace } from '../internal/stackTraces/stackTrace';
import { CodeFlowFrame, ICallFrame, ScriptCallFrame } from '../internal/stackTraces/callFrame';
import { createCallFrameName } from '../internal/stackTraces/callFrameName';
import { Scope } from '../internal/stackTraces/scopes';
import { LineNumber, ColumnNumber } from '../internal/locations/subtypes';
import { IResourceIdentifier } from '../internal/sources/resourceIdentifier';
import { adaptToSinglIntoToMulti } from '../../utils';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';

export type CDTPResource = IScript | URLRegexp | IResourceIdentifier<CDTPScriptUrl>;

interface HasLocation {
    lineNumber: number;
    columnNumber?: number;
}

interface HasScript {
    scriptId: Crdp.Runtime.ScriptId;
}

interface HasScriptLocation extends HasLocation, HasScript { }

// TODO DIEGO: Rename/Refactor this class to CDTPSerializer or something similar
export class TargetToInternal {
    public getBPsFromIDs = adaptToSinglIntoToMulti(this, this.getBPFromID);

    public async toStackTraceCodeFlow(stackTrace: NonNullable<Crdp.Runtime.StackTrace>): Promise<CodeFlowStackTrace<IScript>> {
        return {
            codeFlowFrames: await Promise.all(stackTrace.callFrames.map((callFrame, index) => this.RuntimetoCallFrameCodeFlow(index, callFrame))),
            description: stackTrace.description, parent: stackTrace.parent && await this.toStackTraceCodeFlow(stackTrace.parent)
        };
    }

    private async configurableToCallFrameCodeFlow(index: number, callFrame: Crdp.Runtime.CallFrame | Crdp.Debugger.CallFrame, location: HasScriptLocation): Promise<CodeFlowFrame<IScript>> {
        const scriptLocation = await this.getScriptLocation(location);
        const name = createCallFrameName(scriptLocation.script, callFrame.functionName);
        return new CodeFlowFrame(index, name, scriptLocation);
    }

    public RuntimetoCallFrameCodeFlow(index: number, callFrame: Crdp.Runtime.CallFrame): Promise<CodeFlowFrame<IScript>> {
        return this.configurableToCallFrameCodeFlow(index, callFrame, callFrame);
    }

    public DebuggertoCallFrameCodeFlow(index: number, callFrame: Crdp.Debugger.CallFrame): Promise<CodeFlowFrame<IScript>> {
        return this.configurableToCallFrameCodeFlow(index, callFrame, callFrame.location);
    }

    public async toCallFrame(index: number, callFrame: Crdp.Debugger.CallFrame): Promise<ICallFrame<IScript>> {
        return new ScriptCallFrame(await this.DebuggertoCallFrameCodeFlow(index, callFrame),
            await Promise.all(callFrame.scopeChain.map(scope => this.toScope(scope))),
            callFrame.this, callFrame.returnValue);
    }

    public async toScope(scope: Crdp.Debugger.Scope): Promise<Scope> {
        return {
            type: scope.type,
            object: scope.object,
            name: scope.name,
            // TODO FILE BUG: Chrome sometimes returns line -1 when the doc says it's 0 based
            startLocation: await asyncUndefinedOnFailure(async () => scope.startLocation && await this.toLocationInScript(scope.startLocation)),
            endLocation: await asyncUndefinedOnFailure(async () => scope.endLocation && await this.toLocationInScript(scope.endLocation))
        };
    }

    public toLocationInScript(location: Crdp.Debugger.Location): Promise<LocationInScript> {
        return this.getScriptLocation(location);
    }

    private getLocation(crdpLocation: HasLocation): Coordinates {
        return new Coordinates(crdpLocation.lineNumber as LineNumber, crdpLocation.columnNumber as ColumnNumber);
    }

    private async getScriptLocation(crdpScriptLocation: HasScriptLocation): Promise<LocationInScript> {
        return new LocationInScript(await this._scriptsRegistry.getScriptById(crdpScriptLocation.scriptId), this.getLocation(crdpScriptLocation));
    }

    public getBPFromID(hitBreakpoint: Crdp.Debugger.BreakpointId): IBPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp> {
        return this._breakpointIdRegistry.getRecipieByBreakpointId(hitBreakpoint);
    }

    constructor(
        private readonly _scriptsRegistry: CDTPScriptsRegistry,
        private readonly _breakpointIdRegistry: BreakpointIdRegistry) { }
}
