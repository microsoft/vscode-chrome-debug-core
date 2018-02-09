/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {logger} from 'vscode-debugadapter';
import {ISetBreakpointResult, BreakOnLoadStrategy} from '../debugAdapterInterfaces';

import Crdp from '../../crdp/crdp';
import {ChromeDebugAdapter} from './chromeDebugAdapter';
import * as ChromeUtils from './chromeUtils';

export class BreakOnLoadHelper {

    public userBreakpointOnLine1Col1: boolean = false;
    private _instrumentationBreakpointSet: boolean = false;

    // Break on load: Store some mapping between the requested file names, the regex for the file, and the chrome breakpoint id to perform lookup operations efficiently
    private _stopOnEntryBreakpointIdToRequestedFileName = new Map<string, [string, Set<string>]>();
    private _stopOnEntryRequestedFileNameToBreakpointId = new Map<string, string>();
    private _stopOnEntryRegexToBreakpointId = new Map<string, string>();

    private _chromeDebugAdapter: ChromeDebugAdapter;
    private _breakOnLoadStrategy: BreakOnLoadStrategy;

    public constructor(chromeDebugAdapter: ChromeDebugAdapter, breakOnLoadStrategy: BreakOnLoadStrategy) {
        this.validateStrategy(breakOnLoadStrategy);
        this._chromeDebugAdapter = chromeDebugAdapter;
        this._breakOnLoadStrategy = breakOnLoadStrategy;
    }

    validateStrategy(breakOnLoadStrategy: BreakOnLoadStrategy): void {
        if (breakOnLoadStrategy !== 'regex' && breakOnLoadStrategy !== 'instrument') {
            throw new Error('Invalid breakOnLoadStrategy: ' + breakOnLoadStrategy);
        }
    }

    public get stopOnEntryRequestedFileNameToBreakpointId(): Map<string, string> {
        return this._stopOnEntryRequestedFileNameToBreakpointId;
    }

    public get stopOnEntryBreakpointIdToRequestedFileName(): Map<string, [string, Set<string>]> {
        return this._stopOnEntryBreakpointIdToRequestedFileName;
    }

    private get instrumentationBreakpointSet(): boolean {
        return this._instrumentationBreakpointSet;
    }

    /**
     * Checks and resolves the pending breakpoints of a script given it's source. If any breakpoints were resolved returns true, else false.
     * Used when break on load active, either through Chrome's Instrumentation Breakpoint API or the regex approach
     */
    private async resolvePendingBreakpoints(source: string): Promise<boolean> {
        const normalizedSource = this._chromeDebugAdapter.fixPathCasing(source);
        const pendingBreakpoints = this._chromeDebugAdapter.pendingBreakpointsByUrl.get(normalizedSource);
        // If the file has unbound breakpoints, resolve them and return true
        if (pendingBreakpoints !== undefined) {
            await this._chromeDebugAdapter.resolvePendingBreakpoint(pendingBreakpoints);
            if (!this._chromeDebugAdapter.pendingBreakpointsByUrl.delete(normalizedSource)) {
                logger.warn(`Expected to delete ${normalizedSource} from the list of pending breakpoints, but it wasn't there`);
            }
            return true;
        } else {
            // If no pending breakpoints, return false
            return false;
        }
    }

    /**
     * Checks and resolves the pending breakpoints given a script Id. If any breakpoints were resolved returns true, else false.
     * Used when break on load active, either through Chrome's Instrumentation Breakpoint API or the regex approach
     */
    private async resolvePendingBreakpointsOfPausedScript(scriptId: string): Promise<boolean> {
        const pausedScriptUrl = this._chromeDebugAdapter.scriptsById.get(scriptId).url;
        const sourceMapUrl = this._chromeDebugAdapter.scriptsById.get(scriptId).sourceMapURL;
        const mappedUrl = await this._chromeDebugAdapter.pathTransformer.scriptParsed(pausedScriptUrl);
        let breakpointsResolved = false;

        let sources = await this._chromeDebugAdapter.sourceMapTransformer.scriptParsed(mappedUrl, sourceMapUrl);

        // If user breakpoint was put in a typescript file, pendingBreakpoints would store the typescript file in the mapping, so we need to hit those
        if (sources) {
            for (let source of sources) {
                let anySourceBPResolved = await this.resolvePendingBreakpoints(source);
                // If any of the source files had breakpoints resolved, we should return true
                breakpointsResolved = breakpointsResolved || anySourceBPResolved;
            }
        }
        // If sources is not present or user breakpoint was put in a compiled javascript file
        let scriptBPResolved = await this.resolvePendingBreakpoints(mappedUrl);
        breakpointsResolved = breakpointsResolved || scriptBPResolved;

        return breakpointsResolved;
    }

    /**
     * Handles the onpaused event.
     * Checks if the event is caused by a stopOnEntry breakpoint of using the regex approach, or the paused event due to the Chrome's instrument approach
     * Returns whether we should continue or not on this paused event
     */
    public async handleOnPaused(notification: Crdp.Debugger.PausedEvent): Promise<boolean> {
        if (notification.hitBreakpoints && notification.hitBreakpoints.length) {
            // If breakOnLoadStrategy is set to regex, we may have hit a stopOnEntry breakpoint we put.
            // So we need to resolve all the pending breakpoints in this script and then decide to continue or not
            if (this._breakOnLoadStrategy === 'regex') {
                let shouldContinue = await this.handleStopOnEntryBreakpointAndContinue(notification);
                return shouldContinue;
            }
        } else if (notification.reason === 'EventListener' && notification.data.eventName === "instrumentation:scriptFirstStatement" ) {
            // This is fired when Chrome stops on the first line of a script when using the setInstrumentationBreakpoint API

            const pausedScriptId = notification.callFrames[0].location.scriptId;
            // Now we should resolve all the pending breakpoints and then continue
            await this.resolvePendingBreakpointsOfPausedScript(pausedScriptId);
            return true;
        }
        return false;
    }

    /**
     * Returns whether we should continue on hitting a stopOnEntry breakpoint
     * Only used when using regex approach for break on load
     */
    private async shouldContinueOnStopOnEntryBreakpoint(scriptId: string): Promise<boolean> {
        // If the file has no unbound breakpoints or none of the resolved breakpoints are at (1,1), we should continue after hitting the stopOnEntry breakpoint
        let shouldContinue = true;
        let anyPendingBreakpointsResolved = await this.resolvePendingBreakpointsOfPausedScript(scriptId);

        // If there were any pending breakpoints resolved and any of them was at (1,1) we shouldn't continue
        if (anyPendingBreakpointsResolved && this.userBreakpointOnLine1Col1) {
            // Here we need to store this information per file, but since we can safely assume that scriptParsed would immediately be followed by onPaused event
            // for the breakonload files, this implementation should be fine
            this.userBreakpointOnLine1Col1 = false;
            shouldContinue = false;
        }

        return shouldContinue;
    }

    /**
     * Handles a script with a stop on entry breakpoint and returns whether we should continue or not on hitting that breakpoint
     * Only used when using regex approach for break on load
     */
    private async handleStopOnEntryBreakpointAndContinue(notification: Crdp.Debugger.PausedEvent): Promise<boolean> {
        const hitBreakpoints = notification.hitBreakpoints;
        let allStopOnEntryBreakpoints = true;

        // If there is a breakpoint which is not a stopOnEntry breakpoint, we appear as if we hit that one
        // This is particularly done for cases when we end up with a user breakpoint and a stopOnEntry breakpoint on the same line
        hitBreakpoints.forEach(bp => {
            if (!this._stopOnEntryBreakpointIdToRequestedFileName.has(bp)) {
                notification.hitBreakpoints = [bp];
                allStopOnEntryBreakpoints = false;
            }
        });

        // If all the breakpoints on this point are stopOnEntry breakpoints
        // This will be true in cases where it's a single breakpoint and it's a stopOnEntry breakpoint
        // This can also be true when we have multiple breakpoints and all of them are stopOnEntry breakpoints, for example in cases like index.js and index.bin.js
        // Suppose user puts breakpoints in both index.js and index.bin.js files, when the setBreakpoints function is called for index.js it will set a stopOnEntry
        // breakpoint on index.* files which will also match index.bin.js. Now when setBreakpoints is called for index.bin.js it will again put a stopOnEntry breakpoint
        // in itself. So when the file is actually loaded, we would have 2 stopOnEntry breakpoints */

        if (allStopOnEntryBreakpoints) {
            const pausedScriptId = notification.callFrames[0].location.scriptId;
            let shouldContinue = await this.shouldContinueOnStopOnEntryBreakpoint(pausedScriptId);
            if (shouldContinue) {
                return true;
            }
        }
        return false;
    }

    /**
     * Adds a stopOnEntry breakpoint for the given script url
     * Only used when using regex approach for break on load
     */
    private async addStopOnEntryBreakpoint(url: string): Promise<ISetBreakpointResult[]> {
        let responsePs: ISetBreakpointResult[];
        // Check if file already has a stop on entry breakpoint
        if (!this._stopOnEntryRequestedFileNameToBreakpointId.has(url)) {

            // Generate regex we need for the file
            const urlRegex = ChromeUtils.getUrlRegexForBreakOnLoad(url);

            // Check if we already have a breakpoint for this regexp since two different files like script.ts and script.js may have the same regexp
            let breakpointId: string;
            breakpointId = this._stopOnEntryRegexToBreakpointId.get(urlRegex);

            // If breakpointId is undefined it means the breakpoint doesn't exist yet so we add it
            if (breakpointId === undefined) {
                let result;
                try {
                    result = await this.setStopOnEntryBreakpoint(urlRegex);
                } catch (e) {
                    logger.log(`Exception occured while trying to set stop on entry breakpoint ${e.message}.`);
                }
                if (result) {
                    breakpointId = result.breakpointId;
                    this._stopOnEntryRegexToBreakpointId.set(urlRegex, breakpointId);
                } else {
                    logger.log(`BreakpointId was null when trying to set on urlregex ${urlRegex}. This normally happens if the breakpoint already exists.`);
                }
                responsePs = [result];
            } else {
                responsePs = [];
            }

            // Store the new breakpointId and the file name in the right mappings
            this._stopOnEntryRequestedFileNameToBreakpointId.set(url, breakpointId);

            let regexAndFileNames = this._stopOnEntryBreakpointIdToRequestedFileName.get(breakpointId);

            // If there already exists an entry for the breakpoint Id, we add this file to the list of file mappings
            if (regexAndFileNames !== undefined) {
                regexAndFileNames[1].add(url);
            } else { // else create an entry for this breakpoint id
                const fileSet = new Set<string>();
                fileSet.add(url);
                this._stopOnEntryBreakpointIdToRequestedFileName.set(breakpointId, [urlRegex, fileSet]);
            }
        } else {
            responsePs = [];
        }
        return Promise.all(responsePs);
    }

    /**
     * Handles the AddBreakpoints request when break on load is active
     * Takes the action based on the strategy
     */
    public async handleAddBreakpoints(url: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<ISetBreakpointResult[]> {
        // If the strategy is set to regex, we try to match the file where user put the breakpoint through a regex and tell Chrome to put a stop on entry breakpoint there
        if (this._breakOnLoadStrategy === 'regex') {
        await this.addStopOnEntryBreakpoint(url);
        } else if (this._breakOnLoadStrategy === 'instrument') {
            // Else if strategy is to use Chrome's experimental instrumentation API, we stop on all the scripts at the first statement before execution
            if (!this.instrumentationBreakpointSet) {
                await this.setInstrumentationBreakpoint();
            }
        }

        // Temporary fix: We return an empty element for each breakpoint that was requested
        return breakpoints.map(breakpoint => { return {}; });
    }

    /**
     * Tells Chrome to set instrumentation breakpoint to stop on all the scripts before execution
     * Only used when using instrument approach for break on load
     */
    private async setInstrumentationBreakpoint(): Promise<void> {
        this._chromeDebugAdapter.chrome.DOMDebugger.setInstrumentationBreakpoint({eventName: "scriptFirstStatement"});
        this._instrumentationBreakpointSet = true;
    }

    // Sets a breakpoint on (0,0) for the files matching the given regex
    private async setStopOnEntryBreakpoint(urlRegex: string): Promise<Crdp.Debugger.SetBreakpointByUrlResponse> {
        let result = await this._chromeDebugAdapter.chrome.Debugger.setBreakpointByUrl({ urlRegex, lineNumber: 0, columnNumber: 0 });
        return result;
    }

    /**
     * Checks if we need to call resolvePendingBPs on scriptParsed event
     * If break on load is active and we are using the regex approach, only call the resolvePendingBreakpoint function for files where we do not
     * set break on load breakpoints. For those files, it is called from onPaused function.
     * For the default Chrome's API approach, we don't need to call resolvePendingBPs from inside scriptParsed
     */
    public shouldResolvePendingBPs(mappedUrl: string): boolean {
        if (this._breakOnLoadStrategy === 'regex' && !this.stopOnEntryRequestedFileNameToBreakpointId.has(mappedUrl)) {
            return true;
        }
        return false;
    }
}