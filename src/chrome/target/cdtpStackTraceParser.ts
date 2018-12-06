import { Crdp, } from '../..';
import { IScript, } from '../internal/scripts/script';
import { CDTPScriptUrl } from '../internal/sources/resourceIdentifierSubtypes';
import { URLRegexp } from '../internal/breakpoints/bpRecipie';
import { CodeFlowStackTrace } from '../internal/stackTraces/stackTrace';
import { CodeFlowFrame } from '../internal/stackTraces/callFrame';
import { createCallFrameName } from '../internal/stackTraces/callFrameName';
import { IResourceIdentifier } from '../internal/sources/resourceIdentifier';
import { CDTPLocationParser, HasScriptLocation } from './cdtpLocationParser';

export type CDTPResource = IScript | URLRegexp | IResourceIdentifier<CDTPScriptUrl>;

export class CDTPStackTraceParser {
    public async toStackTraceCodeFlow(stackTrace: NonNullable<Crdp.Runtime.StackTrace>): Promise<CodeFlowStackTrace<IScript>> {
        return {
            codeFlowFrames: await Promise.all(stackTrace.callFrames.map((callFrame, index) => this.RuntimetoCallFrameCodeFlow(index, callFrame))),
            description: stackTrace.description, parent: stackTrace.parent && await this.toStackTraceCodeFlow(stackTrace.parent)
        };
    }

    private RuntimetoCallFrameCodeFlow(index: number, callFrame: Crdp.Runtime.CallFrame): Promise<CodeFlowFrame<IScript>> {
        return this.configurableToCallFrameCodeFlow(index, callFrame, callFrame);
    }

    public async configurableToCallFrameCodeFlow(index: number, callFrame: Crdp.Runtime.CallFrame | Crdp.Debugger.CallFrame, location: HasScriptLocation): Promise<CodeFlowFrame<IScript>> {
        const scriptLocation = await this._cdtpLocationParser.getScriptLocation(location);
        const name = createCallFrameName(scriptLocation.script, callFrame.functionName);
        return new CodeFlowFrame(index, name, scriptLocation);
    }

    constructor(
        private readonly _cdtpLocationParser: CDTPLocationParser) { }
}
