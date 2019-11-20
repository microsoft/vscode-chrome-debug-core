/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { BreakpointEvent, logger } from 'vscode-debugadapter';
import { ISetBreakpointsArgs, ISetBreakpointsResponseBody, ISetBreakpointResult } from '../debugAdapterInterfaces';
import * as ChromeUtils from './chromeUtils';
import { Protocol as Crdp } from 'devtools-protocol';
import { ReasonType } from './stoppedEvent';
import { InternalSourceBreakpoint } from './internalSourceBreakpoint';
import { ScriptContainer } from './scripts';
import { ChromeDebugAdapter } from '..';
import { IPendingBreakpoint, BreakpointSetResult } from './chromeDebugAdapter';

import * as utils from '../utils';
import * as path from 'path';
import * as nls from 'vscode-nls';
import { ChromeConnection } from './chromeConnection';
let localize = nls.loadMessageBundle();

export interface IHitConditionBreakpoint {
    numHits: number;
    shouldPause: (numHits: number) => boolean;
}

/**
 * Encapsulates all the logic surrounding breakpoints (e.g. set, unset, hit count breakpoints, etc.)
 */
export class Breakpoints {

    private static SET_BREAKPOINTS_TIMEOUT = 5000;

    private static HITCONDITION_MATCHER = /^(>|>=|=|<|<=|%)?\s*([0-9]+)$/;

    private _breakpointIdHandles: utils.ReverseHandles<Crdp.Debugger.BreakpointId>;
    private _nextUnboundBreakpointId = 0;
    private _pendingBreakpointsByUrl: Map<string, IPendingBreakpoint>;
    private _hitConditionBreakpointsById: Map<Crdp.Debugger.BreakpointId, IHitConditionBreakpoint>;

    // when working with _committedBreakpointsByUrl, we want to keep the url keys canonicalized for consistency
    // use methods getValueFromCommittedBreakpointsByUrl and setValueForCommittedBreakpointsByUrl
    private _committedBreakpointsByUrl = new Map<string, ISetBreakpointResult[]>();
    private _setBreakpointsRequestQ: Promise<any> = Promise.resolve();
    public get breakpointsQueueDrained(): Promise<void> {
        return this._setBreakpointsRequestQ;
    }
    public get committedBreakpointsByUrl(): Map<string, ISetBreakpointResult[]> {
        return this._committedBreakpointsByUrl;
    }

    private getValueFromCommittedBreakpointsByUrl(url: string): ISetBreakpointResult[] {
        let canonicalizedUrl = utils.canonicalizeUrl(url);
        return this._committedBreakpointsByUrl.get(canonicalizedUrl);
    }

    private setValueForCommittedBreakpointsByUrl(url: string, value: ISetBreakpointResult[]): void {
        let canonicalizedUrl = utils.canonicalizeUrl(url);
        this._committedBreakpointsByUrl.set(canonicalizedUrl, value);
    }

    private get chrome() { return this._chromeConnection.api; }

    constructor(
        private readonly adapter: ChromeDebugAdapter,
        private readonly _chromeConnection: ChromeConnection,
    ) {

        this._breakpointIdHandles = new utils.ReverseHandles<Crdp.Debugger.BreakpointId>();
        this._pendingBreakpointsByUrl = new Map<string, IPendingBreakpoint>();
        this._hitConditionBreakpointsById = new Map<Crdp.Debugger.BreakpointId, IHitConditionBreakpoint>();
    }

    reset() {
        this._committedBreakpointsByUrl = new Map<string, ISetBreakpointResult[]>();
        this._setBreakpointsRequestQ = Promise.resolve();
    }

    /**
     * Using the request object from the DAP, set all breakpoints on the target
     * @param args The setBreakpointRequest arguments from the DAP client
     * @param scripts The script container associated with this instance of the adapter
     * @param requestSeq The request sequence number from the DAP
     * @param ids IDs passed in for previously unverified breakpoints
     */
    public setBreakpoints(args: ISetBreakpointsArgs, scripts: ScriptContainer, requestSeq: number, ids?: number[]): Promise<ISetBreakpointsResponseBody> {

        if (args.source.path) {
            args.source.path = this.adapter.displayPathToRealPath(args.source.path);
            args.source.path = utils.canonicalizeUrl(args.source.path);
        }

        return this.validateBreakpointsPath(args)
            .then(() => {
                // Deep copy the args that we are going to modify, and keep the original values in originalArgs
                const originalArgs = args;
                args = JSON.parse(JSON.stringify(args));
                args = this.adapter.lineColTransformer.setBreakpoints(args);
                const sourceMapTransformerResponse = this.adapter.sourceMapTransformer.setBreakpoints(args, requestSeq, ids);
                if (sourceMapTransformerResponse && sourceMapTransformerResponse.args) {
                    args = sourceMapTransformerResponse.args;
                }
                if (sourceMapTransformerResponse && sourceMapTransformerResponse.ids) {
                    ids = sourceMapTransformerResponse.ids;
                }
                args.source = this.adapter.pathTransformer.setBreakpoints(args.source);

                // Get the target url of the script
                let targetScriptUrl: string;
                if (args.source.sourceReference) {
                    const handle = scripts.getSource(args.source.sourceReference);
                    if ((!handle || !handle.scriptId) && args.source.path) {
                        // A sourcemapped script with inline sources won't have a scriptId here, but the
                        // source.path has been fixed.
                        targetScriptUrl = args.source.path;
                    } else {
                        const targetScript = scripts.getScriptById(handle.scriptId);
                        if (targetScript) {
                            targetScriptUrl = targetScript.url;
                        }
                    }
                } else if (args.source.path) {
                    targetScriptUrl = args.source.path;
                }

                if (targetScriptUrl) {
                    // DebugProtocol sends all current breakpoints for the script. Clear all breakpoints for the script then add all of them
                    const internalBPs = args.breakpoints.map(bp => new InternalSourceBreakpoint(bp));
                    const setBreakpointsPFailOnError = this._setBreakpointsRequestQ
                        .then(() => this.clearAllBreakpoints(targetScriptUrl))
                        .then(() => this.addBreakpoints(targetScriptUrl, internalBPs, scripts))
                        .then(responses => ({ breakpoints: this.targetBreakpointResponsesToBreakpointSetResults(targetScriptUrl, responses, internalBPs, ids) }));

                    const setBreakpointsPTimeout = utils.promiseTimeout(setBreakpointsPFailOnError, Breakpoints.SET_BREAKPOINTS_TIMEOUT, localize('setBPTimedOut', 'Set breakpoints request timed out'));

                    // Do just one setBreakpointsRequest at a time to avoid interleaving breakpoint removed/breakpoint added requests to Crdp, which causes issues.
                    // Swallow errors in the promise queue chain so it doesn't get blocked, but return the failing promise for error handling.
                    this._setBreakpointsRequestQ = setBreakpointsPTimeout.catch(e => {
                        // Log the timeout, but any other error will be logged elsewhere
                        if (e.message && e.message.indexOf('timed out') >= 0) {
                            logger.error(e.stack);
                        }
                    });

                    // Return the setBP request, no matter how long it takes. It may take awhile in Node 7.5 - 7.7, see https://github.com/nodejs/node/issues/11589
                    return setBreakpointsPFailOnError.then(setBpResultBody => {
                        const body = { breakpoints: setBpResultBody.breakpoints.map(setBpResult => setBpResult.breakpoint) };
                        if (body.breakpoints.every(bp => !bp.verified)) {
                            // We need to send the original args to avoid adjusting the line and column numbers twice here
                            return this.unverifiedBpResponseForBreakpoints(originalArgs, requestSeq, targetScriptUrl, body.breakpoints, localize('bp.fail.unbound', 'Breakpoint set but not yet bound'));
                        }
                        body.breakpoints = this.adapter.sourceMapTransformer.setBreakpointsResponse(body.breakpoints, true, requestSeq) || body.breakpoints;
                        this.adapter.lineColTransformer.setBreakpointsResponse(body);
                        return body;
                    });
                } else {
                    return Promise.resolve(this.unverifiedBpResponse(args, requestSeq, undefined, localize('bp.fail.noscript', "Can't find script for breakpoint request")));
                }
            },
            e => this.unverifiedBpResponse(args, requestSeq, undefined, e.message));
    }

    protected validateBreakpointsPath(args: ISetBreakpointsArgs): Promise<void> {
        if (!args.source.path || args.source.sourceReference) return Promise.resolve();

        // When break on load is active, we don't need to validate the path, so return
        if (this.adapter.breakOnLoadActive) {
            return Promise.resolve();
        }

        return this.adapter.sourceMapTransformer.getGeneratedPathFromAuthoredPath(args.source.path).then<void>(mappedPath => {

            if (!mappedPath) {
                return utils.errP(localize('validateBP.sourcemapFail', 'Breakpoint ignored because generated code not found (source map problem?).'));
            }

            const targetPath = this.adapter.pathTransformer.getTargetPathFromClientPath(mappedPath);
            if (!targetPath) {
                return utils.errP(localize('validateBP.notFound', 'Breakpoint ignored because target path not found'));
            }

            return undefined;
        });
    }

    /**
     * Makes the actual call to either Debugger.setBreakpoint or Debugger.setBreakpointByUrl, and returns the response.
     * Responses from setBreakpointByUrl are transformed to look like the response from setBreakpoint, so they can be
     * handled the same.
     */
    protected async addBreakpoints(url: string, breakpoints: InternalSourceBreakpoint[], scripts: ScriptContainer) {
        let responsePs: Promise<ISetBreakpointResult>[];
        if (ChromeUtils.isEvalScript(url)) {
            // eval script with no real url - use debugger_setBreakpoint
            const scriptId: Crdp.Runtime.ScriptId = utils.lstrip(url, ChromeUtils.EVAL_NAME_PREFIX);
            responsePs = breakpoints.map(({ line, column = 0, condition }) => this.chrome.Debugger.setBreakpoint({ location: { scriptId, lineNumber: line, columnNumber: column }, condition }));
        } else {
            // script that has a url - use debugger_setBreakpointByUrl so that Chrome will rebind the breakpoint immediately
            // after refreshing the page. This is the only way to allow hitting breakpoints in code that runs immediately when
            // the page loads.
            const script = scripts.getScriptByUrl(url);

            // If script has been parsed, script object won't be undefined and we would have the mapping file on the disk and we can directly set breakpoint using that
            if (!this.adapter.breakOnLoadActive || script) {
                const urlRegex = utils.pathToRegex(url);
                responsePs = breakpoints.map(({ line, column = 0, condition }) => {
                    return this.addOneBreakpointByUrl(script && script.scriptId, urlRegex, line, column, condition);
                });
            } else { // Else if script hasn't been parsed and break on load is active, we need to do extra processing
                if (this.adapter.breakOnLoadActive) {
                    return await this.adapter.breakOnLoadHelper.handleAddBreakpoints(url, breakpoints);
                }
            }
        }

        // Join all setBreakpoint requests to a single promise
        return Promise.all(responsePs);
    }

    /**
     * Adds a single breakpoint in the target using the url for the script
     * @param scriptId the chrome-devtools script id for the script on which we want to add a breakpoint
     * @param urlRegex The regular expression string which will be used to find the correct url on which to set the breakpoint
     * @param lineNumber Line number of the breakpoint
     * @param columnNumber Column number of the breakpoint
     * @param condition The (optional) breakpoint condition
     */
    async addOneBreakpointByUrl(scriptId: Crdp.Runtime.ScriptId | undefined, urlRegex: string, lineNumber: number, columnNumber: number, condition: string): Promise<ISetBreakpointResult> {
        let bpLocation = { lineNumber, columnNumber };
        if (this.adapter.columnBreakpointsEnabled && scriptId) { // scriptId undefined when script not yet loaded, can't fix up column BP :(
            try {
                const possibleBpResponse = await this.chrome.Debugger.getPossibleBreakpoints({
                    start: { scriptId, lineNumber, columnNumber: 0 },
                    end: { scriptId, lineNumber: lineNumber + 1, columnNumber: 0 },
                    restrictToFunction: false });
                if (possibleBpResponse.locations.length) {
                    const selectedLocation = ChromeUtils.selectBreakpointLocation(lineNumber, columnNumber, possibleBpResponse.locations);
                    bpLocation = { lineNumber: selectedLocation.lineNumber, columnNumber: selectedLocation.columnNumber || 0 };
                }
            } catch (e) {
                // getPossibleBPs not supported
            }
        }

        let result;
        try {
            result = await this.chrome.Debugger.setBreakpointByUrl({ urlRegex, lineNumber: bpLocation.lineNumber, columnNumber: bpLocation.columnNumber, condition });
        } catch (e) {
            if (e.message === 'Breakpoint at specified location already exists.') {
                return {
                    actualLocation: { lineNumber: bpLocation.lineNumber, columnNumber: bpLocation.columnNumber, scriptId }
                };
            } else {
                throw e;
            }
        }

        // Now convert the response to a SetBreakpointResponse so both response types can be handled the same
        const locations = result.locations;
        return <Crdp.Debugger.SetBreakpointResponse>{
            breakpointId: result.breakpointId,
            actualLocation: locations[0] && {
                lineNumber: locations[0].lineNumber,
                columnNumber: locations[0].columnNumber,
                scriptId
            }
        };
    }

    /**
     * Using the request object from the DAP, set all breakpoints on the target
     * @param args The setBreakpointRequest arguments from the DAP client
     * @param scripts The script container associated with this instance of the adapter
     * @param requestSeq The request sequence number from the DAP
     * @param ids IDs passed in for previously unverified breakpoints
     */
    public async getBreakpointsLocations(args: DebugProtocol.BreakpointLocationsArguments, scripts: ScriptContainer, requestSeq: number): Promise<DebugProtocol.BreakpointLocationsResponse['body']> {

        if (args.source.path) {
            args.source.path = this.adapter.displayPathToRealPath(args.source.path);
            args.source.path = utils.canonicalizeUrl(args.source.path);
        }

        try {
            await this.validateBreakpointsPath(args);
        } catch (e) {
            logger.log('breakpointsLocations failed: ' + e.message);
            return { breakpoints: [] };
        }

        // Deep copy the args that we are going to modify, and keep the original values in originalArgs
        args = JSON.parse(JSON.stringify(args));
        args.endLine = this.adapter.lineColTransformer.convertClientLineToDebugger(typeof args.endLine === 'number' ? args.endLine : args.line + 1);
        args.endColumn = this.adapter.lineColTransformer.convertClientLineToDebugger(args.endColumn || 1);
        args.line = this.adapter.lineColTransformer.convertClientLineToDebugger(args.line);
        args.column = this.adapter.lineColTransformer.convertClientColumnToDebugger(args.column || 1);

        if (args.source.path) {
            const source1 = JSON.parse(JSON.stringify(args.source));
            const startArgs = this.adapter.sourceMapTransformer.setBreakpoints({ breakpoints: [{ line: args.line, column: args.column }], source: source1 }, requestSeq);
            args.line = startArgs.args.breakpoints[0].line;
            args.column = startArgs.args.breakpoints[0].column;

            const endArgs = this.adapter.sourceMapTransformer.setBreakpoints({ breakpoints: [{ line: args.endLine, column: args.endColumn }], source: args.source }, requestSeq);
            args.endLine = endArgs.args.breakpoints[0].line;
            args.endColumn = endArgs.args.breakpoints[0].column;
        }

        args.source = this.adapter.pathTransformer.setBreakpoints(args.source);

        // Get the target url of the script
        let targetScriptUrl: string;
        if (args.source.sourceReference) {
            const handle = scripts.getSource(args.source.sourceReference);
            if ((!handle || !handle.scriptId) && args.source.path) {
                // A sourcemapped script with inline sources won't have a scriptId here, but the
                // source.path has been fixed.
                targetScriptUrl = args.source.path;
            } else {
                const targetScript = scripts.getScriptById(handle.scriptId);
                if (targetScript) {
                    targetScriptUrl = targetScript.url;
                }
            }
        } else if (args.source.path) {
            targetScriptUrl = args.source.path;
        }

        if (targetScriptUrl) {
            const script = scripts.getScriptByUrl(targetScriptUrl);
            if (script) {
                const end = typeof args.endLine === 'number' ?
                    { scriptId: script.scriptId, lineNumber: args.endLine, columnNumber: args.endColumn || 0 } :
                    { scriptId: script.scriptId, lineNumber: args.line + 1, columnNumber: 0 };

                const possibleBpResponse = await this.chrome.Debugger.getPossibleBreakpoints({
                    start: { scriptId: script.scriptId, lineNumber: args.line, columnNumber: args.column || 0 },
                    end,
                    restrictToFunction: false
                });
                if (possibleBpResponse.locations) {
                    let breakpoints = possibleBpResponse.locations.map(loc => {
                        return <DebugProtocol.Breakpoint>{
                            line: loc.lineNumber,
                            column: loc.columnNumber
                        };
                    });
                    breakpoints = this.adapter.sourceMapTransformer.setBreakpointsResponse(breakpoints, false, requestSeq);
                    const response = { breakpoints };
                    this.adapter.lineColTransformer.setBreakpointsResponse(response);
                    return response as DebugProtocol.BreakpointLocationsResponse['body'];
                } else {
                    return { breakpoints: [] };
                }
            }
        }

        return null;
    }

    /**
     * Transform breakpoint responses from the chrome-devtools target to the DAP response
     * @param url The URL of the script for which we are translating breakpoint responses
     * @param responses The setBreakpoint responses from the chrome-devtools target
     * @param requestBps The list of requested breakpoints pending a response
     * @param ids IDs passed in for previously unverified BPs
     */
    private targetBreakpointResponsesToBreakpointSetResults(url: string, responses: ISetBreakpointResult[], requestBps: InternalSourceBreakpoint[], ids?: number[]): BreakpointSetResult[] {
        // Don't cache errored responses
        const committedBps = responses
            .filter(response => response && response.breakpointId);

        // Cache successfully set breakpoint ids from chrome in committedBreakpoints set
        this.setValueForCommittedBreakpointsByUrl(url, committedBps);

        // Map committed breakpoints to DebugProtocol response breakpoints
        return responses
            .map((response, i) => {
                // The output list needs to be the same length as the input list, so map errors to
                // unverified breakpoints.
                if (!response) {
                    return {
                        isSet: false,
                        breakpoint: <DebugProtocol.Breakpoint>{
                            verified: false
                        }
                    };
                }

                // response.breakpointId is undefined when no target BP is backing this BP, e.g. it's at the same location
                // as another BP
                const responseBpId = response.breakpointId || this.generateNextUnboundBreakpointId();

                let bpId: number;
                if (ids && ids[i]) {
                    // IDs passed in for previously unverified BPs
                    bpId = ids[i];
                    this._breakpointIdHandles.set(bpId, responseBpId);
                } else {
                    bpId = this._breakpointIdHandles.lookup(responseBpId) ||
                        this._breakpointIdHandles.create(responseBpId);
                }

                if (!response.actualLocation) {
                    // If we don't have an actualLocation nor a breakpointId this is a pseudo-breakpoint because we are using break-on-load
                    // so we mark the breakpoint as not set, so i'll be set after we load the actual script that has the breakpoint
                    return {
                        isSet: response.breakpointId !== undefined,
                            breakpoint: <DebugProtocol.Breakpoint>{
                                id: bpId,
                                verified: false
                        }
                    };
                }

                const thisBpRequest = requestBps[i];
                if (thisBpRequest.hitCondition) {
                    if (!this.addHitConditionBreakpoint(thisBpRequest, response)) {
                        return  {
                            isSet: true,
                            breakpoint: <DebugProtocol.Breakpoint>{
                                id: bpId,
                                message: localize('invalidHitCondition', 'Invalid hit condition: {0}', thisBpRequest.hitCondition),
                                verified: false
                            }
                        };
                    }
                }

                return {
                    isSet: true,
                    breakpoint: <DebugProtocol.Breakpoint>{
                        id: bpId,
                        verified: true,
                        line: response.actualLocation.lineNumber,
                        column: response.actualLocation.columnNumber
                    }
                };
            });
    }

    private addHitConditionBreakpoint(requestBp: InternalSourceBreakpoint, response: ISetBreakpointResult): boolean {
        const result = Breakpoints.HITCONDITION_MATCHER.exec(requestBp.hitCondition.trim());
        if (result && result.length >= 3) {
            let op = result[1] || '>=';
            if (op === '=') op = '==';
            const value = result[2];
            const expr = op === '%'
                ? `return (numHits % ${value}) === 0;`
                : `return numHits ${op} ${value};`;

            // eval safe because of the regex, and this is only a string that the current user will type in
            /* tslint:disable:no-function-constructor-with-string-args */
            const shouldPause: (numHits: number) => boolean = <any>new Function('numHits', expr);
            /* tslint:enable:no-function-constructor-with-string-args */
            this._hitConditionBreakpointsById.set(response.breakpointId, { numHits: 0, shouldPause });
            return true;
        } else {
            return false;
        }
    }

    private clearAllBreakpoints(url: string): Promise<void> {
        // We want to canonicalize this url because this._committedBreakpointsByUrl keeps url keys in canonicalized form
        url = utils.canonicalizeUrl(url);
        if (!this._committedBreakpointsByUrl.has(url)) {
            return Promise.resolve();
        }

        // Remove breakpoints one at a time. Seems like it would be ok to send the removes all at once,
        // but there is a chrome bug where when removing 5+ or so breakpoints at once, it gets into a weird
        // state where later adds on the same line will fail with 'breakpoint already exists' even though it
        // does not break there.
        return this._committedBreakpointsByUrl.get(url).reduce((p, bp) => {
            return p.then(() => this.chrome.Debugger.removeBreakpoint({ breakpointId: bp.breakpointId })).then(() => { });
        }, Promise.resolve()).then(() => {
            this._committedBreakpointsByUrl.delete(url);
        });
    }

    public onBreakpointResolved(params: Crdp.Debugger.BreakpointResolvedEvent, scripts: ScriptContainer): void {
        const script = scripts.getScriptById(params.location.scriptId);
        const breakpointId = this._breakpointIdHandles.lookup(params.breakpointId);
        if (!script || !breakpointId) {
            // Breakpoint resolved for a script we don't know about or a breakpoint we don't know about
            return;
        }

        // If the breakpoint resolved is a stopOnEntry breakpoint, we just return since we don't need to send it to client
        if (this.adapter.breakOnLoadActive && this.adapter.breakOnLoadHelper.stopOnEntryBreakpointIdToRequestedFileName.has(params.breakpointId)) {
            return;
        }

        // committed breakpoints (this._committedBreakpointsByUrl) should always have url keys in canonicalized form
        const committedBps = this.getValueFromCommittedBreakpointsByUrl(script.url) || [];

        if (!committedBps.find(committedBp => committedBp.breakpointId === params.breakpointId)) {
            committedBps.push({breakpointId: params.breakpointId, actualLocation: params.location});
        }
        this.setValueForCommittedBreakpointsByUrl(script.url, committedBps);

        const bp = <DebugProtocol.Breakpoint>{
            id: breakpointId,
            verified: true,
            line: params.location.lineNumber,
            column: params.location.columnNumber
        };

        // need to canonicalize this path because the following maps use paths canonicalized
        const scriptPath = utils.canonicalizeUrl(this.adapter.pathTransformer.breakpointResolved(bp, script.url));

        if (this._pendingBreakpointsByUrl.has(scriptPath)) {
            // If we set these BPs before the script was loaded, remove from the pending list
            this._pendingBreakpointsByUrl.delete(scriptPath);
        }
        this.adapter.sourceMapTransformer.breakpointResolved(bp, scriptPath);
        this.adapter.lineColTransformer.breakpointResolved(bp);
        this.adapter.session.sendEvent(new BreakpointEvent('changed', bp));
    }

    private generateNextUnboundBreakpointId(): string {
        const unboundBreakpointUniquePrefix = '__::[vscode_chrome_debug_adapter_unbound_breakpoint]::';
        return `${unboundBreakpointUniquePrefix}${this._nextUnboundBreakpointId++}`;
    }

    private unverifiedBpResponse(args: ISetBreakpointsArgs, requestSeq: number, targetScriptUrl: string, message?: string): ISetBreakpointsResponseBody {
        const breakpoints = args.breakpoints.map(bp => {
            return <DebugProtocol.Breakpoint>{
                verified: false,
                line: bp.line,
                column: bp.column,
                message,
                id: this._breakpointIdHandles.create(this.generateNextUnboundBreakpointId())
            };
        });

        return this.unverifiedBpResponseForBreakpoints(args, requestSeq, targetScriptUrl, breakpoints, message);
    }

    private unverifiedBpResponseForBreakpoints(args: ISetBreakpointsArgs, requestSeq: number, targetScriptUrl: string, breakpoints: DebugProtocol.Breakpoint[], defaultMessage?: string): ISetBreakpointsResponseBody {
        breakpoints.forEach(bp => {
            if (!bp.message) {
                bp.message = defaultMessage;
            }
        });

        if (args.source.path) {
            const ids = breakpoints.map(bp => bp.id);

            // setWithPath: record whether we attempted to set the breakpoint, and if so, with which path.
            // We can use this to tell when the script is loaded whether we guessed correctly, and predict whether the BP will bind.
            this._pendingBreakpointsByUrl.set(
                utils.canonicalizeUrl(args.source.path),
                { args, ids, requestSeq, setWithPath: this.adapter.breakOnLoadActive ? '' : targetScriptUrl }); // Breakpoints need to be re-set when break-on-load is enabled
        }

        return { breakpoints };
    }

    public async handleScriptParsed(script: Crdp.Debugger.ScriptParsedEvent, scripts: ScriptContainer, mappedUrl: string, sources: string[]) {
        if (sources) {
            const filteredSources = sources.filter(source => source !== mappedUrl); // Tools like babel-register will produce sources with the same path as the generated script
            for (const filteredSource of filteredSources) {
                await this.resolvePendingBPs(filteredSource, scripts);
            }
        }

        if (utils.canonicalizeUrl(script.url) === mappedUrl && this._pendingBreakpointsByUrl.has(mappedUrl) && utils.canonicalizeUrl(this._pendingBreakpointsByUrl.get(mappedUrl).setWithPath) === utils.canonicalizeUrl(mappedUrl)) {
            // If the pathTransformer had no effect, and we attempted to set the BPs with that path earlier, then assume that they are about
            // to be resolved in this loaded script, and remove the pendingBP.
            this._pendingBreakpointsByUrl.delete(mappedUrl);
        } else {
            await this.resolvePendingBPs(mappedUrl, scripts);
        }
    }

    public async resolvePendingBPs (source: string, scripts: ScriptContainer) {
        source = source && utils.canonicalizeUrl(source);
        const pendingBP = this._pendingBreakpointsByUrl.get(source);
        if (pendingBP && (!pendingBP.setWithPath || utils.canonicalizeUrl(pendingBP.setWithPath) === source)) {
            logger.log(`OnScriptParsed.resolvePendingBPs: Resolving pending breakpoints: ${JSON.stringify(pendingBP)}`);
            await this.resolvePendingBreakpoint(pendingBP, scripts);
            this._pendingBreakpointsByUrl.delete(source);
        } else if (source) {
            const sourceFileName = path.basename(source).toLowerCase();
            if (Array.from(this._pendingBreakpointsByUrl.keys()).find(key => key.toLowerCase().indexOf(sourceFileName) > -1)) {
                logger.log(`OnScriptParsed.resolvePendingBPs: The following pending breakpoints won't be resolved: ${JSON.stringify(pendingBP)} pendingBreakpointsByUrl = ${JSON.stringify([...this._pendingBreakpointsByUrl])} source = ${source}`);
            }
        }
    }

    public resolvePendingBreakpoint(pendingBP: IPendingBreakpoint, scripts: ScriptContainer): Promise<void> {
        return this.setBreakpoints(pendingBP.args, scripts, pendingBP.requestSeq, pendingBP.ids).then(response => {
            response.breakpoints.forEach((bp, i) => {
                bp.id = pendingBP.ids[i];
                this.adapter.session.sendEvent(new BreakpointEvent('changed', bp));
            });
        });
    }

    public handleHitCountBreakpoints(expectingStopReason: ReasonType, hitBreakpoints) {
        // Did we hit a hit condition breakpoint?
        for (let hitBp of hitBreakpoints) {
            if (this._hitConditionBreakpointsById.has(hitBp)) {
                // Increment the hit count and check whether to pause
                const hitConditionBp = this._hitConditionBreakpointsById.get(hitBp);
                hitConditionBp.numHits++;
                // Only resume if we didn't break for some user action (step, pause button)
                if (!expectingStopReason && !hitConditionBp.shouldPause(hitConditionBp.numHits)) {
                    this.chrome.Debugger.resume()
                        .catch(() => { /* ignore failures */ });
                    return { didPause: false };
                }
            }
        }
        return null;
    }

}
