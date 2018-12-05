import { Crdp, utils } from '../..';

export interface IBreakpointFeaturesSupport {
    supportsColumnBreakpoints: Promise<boolean>;
}

export class BreakpointFeaturesSupport implements IBreakpointFeaturesSupport {
    private result = utils.promiseDefer<boolean>();

    public supportsColumnBreakpoints = this.result.promise;

    private async onScriptParsed(params: Crdp.Debugger.ScriptParsedEvent): Promise<void> {
        const scriptId = params.scriptId;

        try {
            await this.api.Debugger.getPossibleBreakpoints({
                start: { scriptId, lineNumber: 0, columnNumber: 0 },
                end: { scriptId, lineNumber: 1, columnNumber: 0 },
                restrictToFunction: false
            });
            this.result.resolve(true);
        } catch (e) {
            this.result.resolve(false);
        }
    }

    constructor(protected readonly api: Crdp.ProtocolApi) {
        api.Debugger.on('scriptParsed', params => this.onScriptParsed(params));
    }
}