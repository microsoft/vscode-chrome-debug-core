/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {StoppedEvent, InitializedEvent, TerminatedEvent, OutputEvent, Handles, Event} from 'vscode-debugadapter';

import {IDebugAdapter, ILaunchRequestArgs, ISetBreakpointsArgs, ISetBreakpointsResponseBody, IStackTraceResponseBody,
    IAttachRequestArgs, IBreakpoint, IScopesResponseBody, IVariablesResponseBody, IGetVariableResponseBody,
    ISourceResponseBody, IThreadsResponseBody, IEvaluateResponseBody} from '../debugAdapterInterfaces';
import {ChromeConnection} from './chromeConnection';
import * as ChromeUtils from './chromeUtils';
import * as utils from '../utils';
import * as logger from '../logger';
import {formatConsoleMessage} from './consoleHelper';
import * as Chrome from './chromeDebugProtocol';

import {spawn, ChildProcess} from 'child_process';
import * as path from 'path';

interface IScopeVarHandle {
    objectId: string;
    thisObj?: Chrome.Runtime.RemoteObject;
}

export class ChromeDebugAdapter implements IDebugAdapter {
    private static THREAD_ID = 1;
    private static PAGE_PAUSE_MESSAGE = 'Paused in Visual Studio Code';
    private static EXCEPTION_VALUE_ID = 'EXCEPTION_VALUE_ID';
    private static PLACEHOLDER_URL_PROTOCOL = 'debugadapter://';

    private _clientAttached: boolean;
    private _variableHandles: Handles<IScopeVarHandle>;
    private _currentStack: Chrome.Debugger.CallFrame[];
    private _committedBreakpointsByUrl: Map<string, Chrome.Debugger.BreakpointId[]>;
    private _overlayHelper: utils.DebounceHelper;
    private _exceptionValueObject: Chrome.Runtime.RemoteObject;
    private _expectingResumedEvent: boolean;
    private _setBreakpointsRequestQ: Promise<any>;

    private _scriptsById: Map<Chrome.Debugger.ScriptId, Chrome.Debugger.Script>;
    private _scriptsByUrl: Map<string, Chrome.Debugger.Script>;

    private _chromeProc: ChildProcess;
    private _eventHandler: (event: DebugProtocol.Event) => void;

    protected _chromeConnection: ChromeConnection;

    public constructor(chromeConnection: ChromeConnection) {
        this._chromeConnection = chromeConnection;
        this._variableHandles = new Handles<IScopeVarHandle>();
        this._overlayHelper = new utils.DebounceHelper(/*timeoutMs=*/200);

        this.clearEverything();
    }

    private get paused(): boolean {
        return !!this._currentStack;
    }

    private clearTargetContext(): void {
        this._scriptsById = new Map<Chrome.Debugger.ScriptId, Chrome.Debugger.Script>();
        this._scriptsByUrl = new Map<string, Chrome.Debugger.Script>();

        this._committedBreakpointsByUrl = new Map<string, Chrome.Debugger.BreakpointId[]>();
        this._setBreakpointsRequestQ = Promise.resolve<void>();

        this.fireEvent(new Event('clearTargetContext'));
    }

    private clearClientContext(): void {
        this._clientAttached = false;
        this.fireEvent(new Event('clearClientContext'));
    }

    public registerEventHandler(eventHandler: (event: DebugProtocol.Event) => void): void {
        this._eventHandler = eventHandler;
    }

    public initialize(args: DebugProtocol.InitializeRequestArguments): DebugProtocol.Capabilites {
        // This debug adapter supports two exception breakpoint filters
        return {
            exceptionBreakpointFilters: [
                {
                    label: 'All Exceptions',
                    filter: 'all',
                    default: false
                },
                {
                    label: 'Uncaught Exceptions',
                    filter: 'uncaught',
                    default: true
                }
            ]
        };
    }

    public launch(args: ILaunchRequestArgs): Promise<void> {
        this.setupLogging(args);

        // Check exists?
        const chromePath = args.runtimeExecutable || utils.getBrowserPath();
        if (!chromePath) {
            return utils.errP(`Can't find Chrome - install it or set the "runtimeExecutable" field in the launch config.`);
        }

        // Start with remote debugging enabled
        const port = args.port || 9222;
        const chromeArgs: string[] = ['--remote-debugging-port=' + port];

        // Also start with extra stuff disabled
        chromeArgs.push(...['--no-first-run', '--no-default-browser-check']);
        if (args.runtimeArgs) {
            chromeArgs.push(...args.runtimeArgs);
        }

        if (args.userDataDir) {
            chromeArgs.push('--user-data-dir=' + args.userDataDir);
        }

        let launchUrl: string;
        if (args.file) {
            launchUrl = utils.pathToFileURL(args.file);
        } else if (args.url) {
            launchUrl = args.url;
        }

        if (launchUrl) {
            chromeArgs.push(launchUrl);
        }

        logger.log(`spawn('${chromePath}', ${JSON.stringify(chromeArgs) })`);
        this._chromeProc = spawn(chromePath, chromeArgs, {
            detached: true,
            stdio: ['ignore']
        });
        this._chromeProc.unref();
        this._chromeProc.on('error', (err) => {
            logger.log('chrome error: ' + err);
            this.terminateSession();
        });

        return this._attach(port, launchUrl, args.address);
    }

    public attach(args: IAttachRequestArgs): Promise<void> {
        if (args.port == null) {
            return utils.errP('The "port" field is required in the attach config.');
        }

        this.setupLogging(args);

        return this._attach(args.port, args.url, args.address);
    }

    public setupLogging(args: IAttachRequestArgs | ILaunchRequestArgs): void {
        const minLogLevel =
            args.verboseDiagnosticLogging ?
                logger.LogLevel.Verbose :
            args.diagnosticLogging ?
                logger.LogLevel.Log :
                logger.LogLevel.Error;
        logger.setMinLogLevel(minLogLevel);

        if (!args.webRoot) {
            logger.log('WARNING: "webRoot" is not set - if resolving sourcemaps fails, please set the "webRoot" property in the launch config.');
        }
    }

    /**
     * Chrome is closing, or error'd somehow, stop the debug session
     */
    public terminateSession(): void {
        if (this._clientAttached) {
            this.fireEvent(new TerminatedEvent());
        }

        this.clearEverything();
    }

    public clearEverything(): void {
        this.clearClientContext();
        this.clearTargetContext();
        this._chromeProc = null;

        if (this._chromeConnection.isAttached) {
            this._chromeConnection.close();
        }
    }

    private _attach(port: number, targetUrl?: string, address?: string): Promise<void> {
        // Client is attaching - if not attached to the chrome target, create a connection and attach
        this._clientAttached = true;
        if (!this._chromeConnection.isAttached) {
            this._chromeConnection.on('Debugger.paused', params => this.onDebuggerPaused(params));
            this._chromeConnection.on('Debugger.resumed', () => this.onDebuggerResumed());
            this._chromeConnection.on('Debugger.scriptParsed', params => this.onScriptParsed(params));
            this._chromeConnection.on('Debugger.globalObjectCleared', () => this.onGlobalObjectCleared());
            this._chromeConnection.on('Debugger.breakpointResolved', params => this.onBreakpointResolved(params));

            this._chromeConnection.on('Console.messageAdded', params => this.onConsoleMessage(params));

            this._chromeConnection.on('Inspector.detached', () => this.terminateSession());
            this._chromeConnection.on('close', () => this.terminateSession());
            this._chromeConnection.on('error', () => this.terminateSession());

            return this._chromeConnection.attach(address, port, targetUrl).then(
                () => this.fireEvent(new InitializedEvent()),
                e => {
                    this.clearEverything();
                    return utils.errP(e);
                });
        } else {
            return Promise.resolve<void>();
        }
    }

    private fireEvent(event: DebugProtocol.Event): void {
        if (this._eventHandler) {
            this._eventHandler(event);
        }
    }

    /**
     * e.g. the target navigated
     */
    private onGlobalObjectCleared(): void {
        this.clearTargetContext();
    }

    protected onDebuggerPaused(notification: Chrome.Debugger.PausedParams): void {

        this._overlayHelper.doAndCancel(() => this._chromeConnection.page_setOverlayMessage(ChromeDebugAdapter.PAGE_PAUSE_MESSAGE));
        this._currentStack = notification.callFrames;

        // We can tell when we've broken on an exception. Otherwise if hitBreakpoints is set, assume we hit a
        // breakpoint. If not set, assume it was a step. We can't tell the difference between step and 'break on anything'.
        let reason: string;
        let exceptionText: string;
        if (notification.reason === 'exception') {
            reason = 'exception';
            if (notification.data && this._currentStack.length) {
                // Insert a scope to wrap the exception object. exceptionText is unused by Code at the moment.
                const remoteObjValue = ChromeUtils.remoteObjectToValue(notification.data, /*stringify=*/false);
                let scopeObject: Chrome.Runtime.RemoteObject;

                if (remoteObjValue.variableHandleRef) {
                    // If the remote object is an object (probably an Error), treat the object like a scope.
                    exceptionText = notification.data.description;
                    scopeObject = notification.data;
                } else {
                    // If it's a value, use a special flag and save the value for later.
                    exceptionText = notification.data.value;
                    scopeObject = <any>{ objectId: ChromeDebugAdapter.EXCEPTION_VALUE_ID };
                    this._exceptionValueObject = notification.data;
                }

                this._currentStack[0].scopeChain.unshift({ type: 'Exception', object: scopeObject });
            }
        } else {
            reason = (notification.hitBreakpoints && notification.hitBreakpoints.length) ? 'breakpoint' : 'step';
        }

        this.fireEvent(new StoppedEvent(reason, /*threadId=*/ChromeDebugAdapter.THREAD_ID, exceptionText));
    }

    protected onDebuggerResumed(): void {
        this._overlayHelper.wait(() => this._chromeConnection.page_clearOverlayMessage());
        this._currentStack = null;

        if (!this._expectingResumedEvent) {
            // This is a private undocumented event provided by VS Code to support the 'continue' button on a paused Chrome page
            let resumedEvent = new Event('continued', { threadId: ChromeDebugAdapter.THREAD_ID });
            this.fireEvent(resumedEvent);
        } else {
            this._expectingResumedEvent = false;
        }
    }

    protected onScriptParsed(script: Chrome.Debugger.Script): void {
        // Totally ignore extension scripts, internal Chrome scripts, and so on
        if (this.shouldIgnoreScript(script)) {
            return;
        }

        if (!script.url) {
            script.url = ChromeDebugAdapter.PLACEHOLDER_URL_PROTOCOL + script.scriptId;
        }

        this._scriptsById.set(script.scriptId, script);
        this._scriptsByUrl.set(script.url, script);
        this.fireEvent(new Event('scriptParsed', { scriptUrl: script.url, sourceMapURL: script.sourceMapURL }));
    }

    protected onBreakpointResolved(params: Chrome.Debugger.BreakpointResolvedParams): void {
        const script = this._scriptsById.get(params.location.scriptId);
        if (!script) {
            // Breakpoint resolved for a script we don't know about
            return;
        }

        const committedBps = this._committedBreakpointsByUrl.get(script.url) || [];
        committedBps.push(params.breakpointId);
        this._committedBreakpointsByUrl.set(script.url, committedBps);
    }

    protected onConsoleMessage(params: Chrome.Console.MessageAddedParams): void {
        const formattedMessage = formatConsoleMessage(params.message);
        if (formattedMessage) {
            this.fireEvent(new OutputEvent(
                formattedMessage.text + '\n',
                formattedMessage.isError ? 'stderr' : 'stdout'));
        }
    }

    public disconnect(): Promise<void> {
        if (this._chromeProc) {
            this._chromeProc.kill('SIGINT');
            this._chromeProc = null;
        }

        this.clearEverything();

        return Promise.resolve<void>();
    }

    public setBreakpoints(args: ISetBreakpointsArgs): Promise<ISetBreakpointsResponseBody> {
        let targetScriptUrl: string;
        if (args.source.path) {
            targetScriptUrl = args.source.path;
        } else if (args.source.sourceReference) {
            const targetScript = this._scriptsById.get(sourceReferenceToScriptId(args.source.sourceReference));
            if (targetScript) {
                targetScriptUrl = targetScript.url;
            }
        }

        if (targetScriptUrl) {
            // DebugProtocol sends all current breakpoints for the script. Clear all scripts for the breakpoint then add all of them
            const setBreakpointsPFailOnError = this._setBreakpointsRequestQ
                .then(() => this.clearAllBreakpoints(targetScriptUrl))
                .then(() => this.addBreakpoints(targetScriptUrl, args.lines, args.cols))
                .then(responses => ({ breakpoints: this.chromeBreakpointResponsesToODPBreakpoints(targetScriptUrl, responses, args.lines) }));

            const setBreakpointsPTimeout = utils.promiseTimeout(setBreakpointsPFailOnError, /*timeoutMs*/2000, 'Set breakpoints request timed out');

            // Do just one setBreakpointsRequest at a time to avoid interleaving breakpoint removed/breakpoint added requests to Chrome.
            // Swallow errors in the promise queue chain so it doesn't get blocked, but return the failing promise for error handling.
            this._setBreakpointsRequestQ = setBreakpointsPTimeout.catch(() => undefined);
            return setBreakpointsPTimeout;
        } else {
            return utils.errP(`Can't find script for breakpoint request`);
        }
    }

    public setFunctionBreakpoints(): Promise<any> {
        return Promise.resolve<void>();
    }

    private clearAllBreakpoints(url: string): Promise<void> {
        if (!this._committedBreakpointsByUrl.has(url)) {
            return Promise.resolve<void>();
        }

        // Remove breakpoints one at a time. Seems like it would be ok to send the removes all at once,
        // but there is a chrome bug where when removing 5+ or so breakpoints at once, it gets into a weird
        // state where later adds on the same line will fail with 'breakpoint already exists' even though it
        // does not break there.
        return this._committedBreakpointsByUrl.get(url).reduce((p, bpId) => {
            return p.then(() => this._chromeConnection.debugger_removeBreakpoint(bpId)).then(() => { });
        }, Promise.resolve<void>()).then(() => {
            this._committedBreakpointsByUrl.set(url, null);
        });
    }

    private addBreakpoints(url: string, lines: number[], cols?: number[]): Promise<Chrome.Debugger.SetBreakpointResponse[]> {
        let responsePs: Promise<Chrome.Debugger.SetBreakpointResponse>[];
        if (url.startsWith(ChromeDebugAdapter.PLACEHOLDER_URL_PROTOCOL)) {
            // eval script with no real url - use debugger_setBreakpoint
            const scriptId = utils.lstrip(url, ChromeDebugAdapter.PLACEHOLDER_URL_PROTOCOL);
            responsePs = lines.map((lineNumber, i) => this._chromeConnection.debugger_setBreakpoint({ scriptId, lineNumber, columnNumber: cols ? cols[i] : 0 }));
        } else {
            // script that has a url - use debugger_setBreakpointByUrl so that Chrome will rebind the breakpoint immediately
            // after refreshing the page. This is the only way to allow hitting breakpoints in code that runs immediately when
            // the page loads.
            const script = this._scriptsByUrl.get(url);
            responsePs = lines.map((lineNumber, i) => {
                return this._chromeConnection.debugger_setBreakpointByUrl(url, lineNumber, cols ? cols[i] : 0).then(response => {
                    // Now convert the response to a SetBreakpointResponse so both response types can be handled the same
                    const locations = response.result.locations;
                    return <Chrome.Debugger.SetBreakpointResponse>{
                        id: response.id,
                        error: response.error,
                        result: {
                            breakpointId: response.result.breakpointId,
                            actualLocation: locations[0] && {
                                lineNumber: locations[0].lineNumber,
                                columnNumber: locations[0].columnNumber,
                                scriptId: script.scriptId
                            }
                        }
                    };
                });
            });
        }

        // Join all setBreakpoint requests to a single promise
        return Promise.all(responsePs);
    }

    private chromeBreakpointResponsesToODPBreakpoints(url: string, responses: Chrome.Debugger.SetBreakpointResponse[], requestLines: number[]): IBreakpoint[] {
        // Don't cache errored responses
        const committedBpIds = responses
            .filter(response => !response.error)
            .map(response => response.result.breakpointId);

        // Cache successfully set breakpoint ids from chrome in committedBreakpoints set
        this._committedBreakpointsByUrl.set(url, committedBpIds);

        // Map committed breakpoints to DebugProtocol response breakpoints
        return responses
            .map((response, i) => {
                // The output list needs to be the same length as the input list, so map errors to
                // unverified breakpoints.
                if (response.error || !response.result.actualLocation) {
                    return <IBreakpoint>{
                        verified: false,
                        line: requestLines[i],
                        column: 0
                    };
                }

                return <IBreakpoint>{
                    verified: true,
                    line: response.result.actualLocation.lineNumber,
                    column: response.result.actualLocation.columnNumber
                };
            });
    }

    public setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments): Promise<void> {
        let state: string;
        if (args.filters.indexOf('all') >= 0) {
            state = 'all';
        } else if (args.filters.indexOf('uncaught') >= 0) {
            state = 'uncaught';
        } else {
            state = 'none';
        }

        return this._chromeConnection.debugger_setPauseOnExceptions(state)
            .then(() => { });
    }

    public continue(): Promise<void> {
        this._expectingResumedEvent = true;
        return this._chromeConnection.debugger_resume()
            .then(() => { });
    }

    public next(): Promise<void> {
        this._expectingResumedEvent = true;
        return this._chromeConnection.debugger_stepOver()
            .then(() => { });
    }

    public stepIn(): Promise<void> {
        this._expectingResumedEvent = true;
        return this._chromeConnection.debugger_stepIn()
            .then(() => { });
    }

    public stepOut(): Promise<void> {
        this._expectingResumedEvent = true;
        return this._chromeConnection.debugger_stepOut()
            .then(() => { });
    }

    public pause(): Promise<void> {
        return this._chromeConnection.debugger_pause()
            .then(() => { });
    }

    public stackTrace(args: DebugProtocol.StackTraceArguments): IStackTraceResponseBody {
        // Only process at the requested number of frames, if 'levels' is specified
        let stack = this._currentStack;
        if (args.levels) {
            stack = this._currentStack.filter((_, i) => i < args.levels);
        }

        const stackFrames: DebugProtocol.StackFrame[] = stack
            .map(({ location, functionName }, i: number) => {
                const line = location.lineNumber;
                const column = location.columnNumber;
                const script = this._scriptsById.get(location.scriptId);

                try {
                    // When the script has a url and isn't one we're ignoring, send the name and path fields. PathTransformer will
                    // attempt to resolve it to a script in the workspace. Otherwise, send the name and sourceReference fields.
                    const source: DebugProtocol.Source =
                        script && !this.shouldIgnoreScript(script) ?
                            {
                                name: path.basename(script.url),
                                path: script.url,
                                sourceReference: scriptIdToSourceReference(script.scriptId) // will be 0'd out by PathTransformer if not needed
                            } :
                            {
                                // Name should be undefined, work around VS Code bug 20274
                                name: 'eval: ' + location.scriptId,
                                path: ChromeDebugAdapter.PLACEHOLDER_URL_PROTOCOL + location.scriptId,
                                sourceReference: scriptIdToSourceReference(location.scriptId)
                            };

                    // If the frame doesn't have a function name, it's either an anonymous function
                    // or eval script. If its source has a name, it's probably an anonymous function.
                    const frameName = functionName || (script.url ? '(anonymous function)' : '(eval code)');
                    return {
                        id: i,
                        name: frameName,
                        source,
                        line: line,
                        column
                    };
                } catch (e) {
                    // Some targets such as the iOS simulator behave badly and return nonsense callFrames.
                    // In these cases, return a dummy stack frame
                    return {
                        id: i,
                        name: 'Unknown',
                        source: {name: 'eval:Unknown', path: ChromeDebugAdapter.PLACEHOLDER_URL_PROTOCOL + 'Unknown'},
                        line,
                        column
                    };
                }
            });

        return { stackFrames };
    }

    public scopes(args: DebugProtocol.ScopesArguments): IScopesResponseBody {
        const scopes = this._currentStack[args.frameId].scopeChain.map((scope: Chrome.Debugger.Scope, i: number) => {
            const scopeHandle: IScopeVarHandle = { objectId: scope.object.objectId };
            if (i === 0) {
                // The first scope should include 'this'. Keep the RemoteObject reference for use by the variables request
                scopeHandle.thisObj = this._currentStack[args.frameId]['this'];
            }

            return <DebugProtocol.Scope>{
                name: scope.type.substr(0, 1).toUpperCase() + scope.type.substr(1), // Take Chrome's scope, uppercase the first letter
                variablesReference: this._variableHandles.create(scopeHandle),
                expensive: scope.type === 'global'
            };
        });

        return { scopes };
    }

    public variables(args: DebugProtocol.VariablesArguments): Promise<IVariablesResponseBody> {
        const handle = this._variableHandles.get(args.variablesReference);
        if (!handle) {
            return Promise.resolve<IVariablesResponseBody>(undefined);
        }

        // If this is the special marker for an exception value, create a fake property descriptor so the usual route can be used
        if (handle.objectId === ChromeDebugAdapter.EXCEPTION_VALUE_ID) {
            const excValuePropDescriptor: Chrome.Runtime.PropertyDescriptor = <any>{ name: 'exception', value: this._exceptionValueObject };
            return Promise.resolve({ variables: [this.propertyDescriptorToVariable(excValuePropDescriptor)] });
        }

        return Promise.all([
            // Need to make two requests to get all properties
            this._chromeConnection.runtime_getProperties(handle.objectId, /*ownProperties=*/false, /*accessorPropertiesOnly=*/true),
            this._chromeConnection.runtime_getProperties(handle.objectId, /*ownProperties=*/true, /*accessorPropertiesOnly=*/false)
        ]).then(getPropsResponses => {
            // Sometimes duplicates will be returned - merge all property descriptors returned
            const propsByName = new Map<string, Chrome.Runtime.PropertyDescriptor>();
            getPropsResponses.forEach(response => {
                if (!response.error) {
                    response.result.result.forEach(propDesc =>
                        propsByName.set(propDesc.name, propDesc));
                }
            });

            // Convert Chrome prop descriptors to DebugProtocol vars, sort the result
            const variables: DebugProtocol.Variable[] = [];
            propsByName.forEach(propDesc => variables.push(this.propertyDescriptorToVariable(propDesc)));
            variables.sort((var1, var2) => var1.name.localeCompare(var2.name));

            // If this is a scope that should have the 'this', prop, insert it at the top of the list
            if (handle.thisObj) {
                variables.unshift(this.propertyDescriptorToVariable(<any>{ name: 'this', value: handle.thisObj }));
            }

            return { variables };
        });
    }

    public getVariable(args: DebugProtocol.GetVariableArguments): Promise<IGetVariableResponseBody> {
        const handle = this._variableHandles.get(args.variablesReference);
        if (handle != null) {
            return this._chromeConnection.runtime_getProperty(handle.objectId, args.name).then(getPropResponse => {
                const { value, variablesReference } = this.remoteObjectToValueWithHandle(getPropResponse.result.result);
                return { value: value, variablesReference: variablesReference };
            });
        } else {
            return Promise.resolve<IGetVariableResponseBody>(undefined);
        }
    }

    public source(args: DebugProtocol.SourceArguments): Promise<ISourceResponseBody> {
        return this._chromeConnection.debugger_getScriptSource(sourceReferenceToScriptId(args.sourceReference)).then(chromeResponse => {
            return { content: chromeResponse.result.scriptSource };
        });
    }

    public threads(): IThreadsResponseBody {
        return {
            threads: [
                {
                    id: ChromeDebugAdapter.THREAD_ID,
                    name: 'Thread ' + ChromeDebugAdapter.THREAD_ID
                }
            ]
        };
    }

    public evaluate(args: DebugProtocol.EvaluateArguments): Promise<IEvaluateResponseBody> {
        let evalPromise: Promise<any>;
        if (this.paused) {
            const callFrameId = this._currentStack[args.frameId].callFrameId;
            evalPromise = this._chromeConnection.debugger_evaluateOnCallFrame(callFrameId, args.expression);
        } else {
            evalPromise = this._chromeConnection.runtime_evaluate(args.expression);
        }

        return evalPromise.then(evalResponse => {
            if (evalResponse.result.wasThrown) {
                const evalResult = evalResponse.result;
                let errorMessage = 'Error';
                if (evalResult.exceptionDetails) {
                    errorMessage = evalResult.exceptionDetails.text;
                } else if (evalResult.result && evalResult.result.description) {
                    errorMessage = evalResult.result.description;
                }
                return utils.errP(errorMessage);
            }

            const { value, variablesReference } = this.remoteObjectToValueWithHandle(evalResponse.result.result);
            return { result: value, variablesReference };
        });
    }

    private propertyDescriptorToVariable(propDesc: Chrome.Runtime.PropertyDescriptor): DebugProtocol.Variable {
        if (propDesc.get || propDesc.set) {
            // A property doesn't have a value here, and we shouldn't evaluate the getter because it may have side effects.
            // Node adapter shows 'undefined', Chrome can eval the getter on demand.
            const variable: DebugProtocol.Variable = { name: propDesc.name, value: 'property', variablesReference: 0 };
            if (propDesc.get) {
                variable.unsolved = true;
            }
            return variable;
        } else {
            const { value, variablesReference } = this.remoteObjectToValueWithHandle(propDesc.value);
            return { name: propDesc.name, value, variablesReference };
        }
    }

    /**
     * Run the object through ChromeUtilities.remoteObjectToValue, and if it returns a variableHandle reference,
     * use it with this instance's variableHandles to create a variable handle.
     */
    private remoteObjectToValueWithHandle(object: Chrome.Runtime.RemoteObject): { value: string, variablesReference: number } {
        const { value, variableHandleRef } = ChromeUtils.remoteObjectToValue(object);
        const result = { value, variablesReference: 0 };
        if (variableHandleRef) {
            result.variablesReference = this._variableHandles.create({ objectId: variableHandleRef });
        }

        return result;
    }

    private shouldIgnoreScript(script: Chrome.Debugger.Script): boolean {
        return script.isContentScript || script.isInternalScript || script.url.startsWith('extensions::') || script.url.startsWith('chrome-extension://');
    }
}

function scriptIdToSourceReference(scriptId: Chrome.Debugger.ScriptId): number {
    return parseInt(scriptId, 10);
}

function sourceReferenceToScriptId(sourceReference: number): Chrome.Debugger.ScriptId {
    return '' + sourceReference;
}
