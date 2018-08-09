/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { InitializedEvent, TerminatedEvent, Handles, ContinuedEvent, BreakpointEvent, OutputEvent, Logger, logger, LoadedSourceEvent } from 'vscode-debugadapter';

import { ICommonRequestArgs, ILaunchRequestArgs, ISetBreakpointsArgs, ISetBreakpointsResponseBody, IStackTraceResponseBody,
    IAttachRequestArgs, IScopesResponseBody, IVariablesResponseBody,
    ISourceResponseBody, IThreadsResponseBody, IEvaluateResponseBody, ISetVariableResponseBody, IDebugAdapter,
    ICompletionsResponseBody, IToggleSkipFileStatusArgs, IInternalStackTraceResponseBody,
    IExceptionInfoResponseBody, ISetBreakpointResult, TimeTravelRuntime, IRestartRequestArgs, IInitializeRequestArgs, ITelemetryPropertyCollector, IGetLoadedSourcesResponseBody } from '../debugAdapterInterfaces';
import { IChromeDebugAdapterOpts, ChromeDebugSession } from './chromeDebugSession';
import { ChromeConnection } from './chromeConnection';
import * as ChromeUtils from './chromeUtils';
import { Protocol as Crdp } from 'devtools-protocol';
import { PropertyContainer, ScopeContainer, ExceptionContainer, isIndexedPropName, IVariableContainer } from './variables';
import * as variables from './variables';
import { formatConsoleArguments, formatExceptionDetails } from './consoleHelper';
import { StoppedEvent2, ReasonType } from './stoppedEvent';
import { InternalSourceBreakpoint, stackTraceWithoutLogpointFrame } from './internalSourceBreakpoint';

import * as errors from '../errors';
import * as utils from '../utils';
import { PromiseDefer, promiseDefer } from '../utils';
import { telemetry, BatchTelemetryReporter, IExecutionResultTelemetryProperties } from '../telemetry';
import { StepProgressEventsEmitter } from '../executionTimingsReporter';

import { LineColTransformer } from '../transformers/lineNumberTransformer';
import { BasePathTransformer } from '../transformers/basePathTransformer';
import { RemotePathTransformer } from '../transformers/remotePathTransformer';
import { BaseSourceMapTransformer } from '../transformers/baseSourceMapTransformer';
import { EagerSourceMapTransformer } from '../transformers/eagerSourceMapTransformer';
import { FallbackToClientPathTransformer } from '../transformers/fallbackToClientPathTransformer';
import { BreakOnLoadHelper } from './breakOnLoadHelper';
import * as sourceMapUtils from '../sourceMaps/sourceMapUtils';

import * as path from 'path';

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

interface IPropCount {
    indexedVariables: number;
    namedVariables: number;
}

/**
 * Represents a reference to a source/script. `contents` is set if there are inlined sources.
 * Otherwise, scriptId can be used to retrieve the contents from the runtime.
 */
export interface ISourceContainer {
    /** The runtime-side scriptId of this script */
    scriptId?: Crdp.Runtime.ScriptId;
    /** The contents of this script, if they are inlined in the sourcemap */
    contents?: string;
    /** The authored path to this script (only set if the contents are inlined) */
    mappedPath?: string;
}

export interface IPendingBreakpoint {
    args: ISetBreakpointsArgs;
    ids: number[];
    requestSeq: number;
    setWithPath: string;
}

interface IHitConditionBreakpoint {
    numHits: number;
    shouldPause: (numHits: number) => boolean;
}

export type VariableContext = 'variables' | 'watch' | 'repl' | 'hover';

export type CrdpScript = Crdp.Debugger.ScriptParsedEvent;

export type CrdpDomain = string;

export type LoadedSourceEventReason = 'new' | 'changed' | 'removed';

export interface BreakpointSetResult {
    isSet: boolean;
    breakpoint: DebugProtocol.Breakpoint;
}

export interface IOnPausedResult {
    didPause: boolean;
}

export abstract class ChromeDebugAdapter implements IDebugAdapter {
    public static EVAL_NAME_PREFIX = ChromeUtils.EVAL_NAME_PREFIX;
    public static EVAL_ROOT = '<eval>';

    private static SCRIPTS_COMMAND = '.scripts';
    private static THREAD_ID = 1;
    private static SET_BREAKPOINTS_TIMEOUT = 5000;
    private static HITCONDITION_MATCHER = /^(>|>=|=|<|<=|%)?\s*([0-9]+)$/;
    private static ASYNC_CALL_STACK_DEPTH = 4;

    protected _session: ChromeDebugSession;
    protected _domains = new Map<CrdpDomain, Crdp.Schema.Domain>();
    private _clientAttached: boolean;
    private _currentPauseNotification: Crdp.Debugger.PausedEvent;
    private _committedBreakpointsByUrl: Map<string, ISetBreakpointResult[]>;
    private _exception: Crdp.Runtime.RemoteObject;
    private _setBreakpointsRequestQ: Promise<any>;
    private _expectingResumedEvent: boolean;
    protected _expectingStopReason: ReasonType;
    private _waitAfterStep = Promise.resolve();

    private _frameHandles: Handles<Crdp.Debugger.CallFrame>;
    private _variableHandles: variables.VariableHandles;
    private _breakpointIdHandles: utils.ReverseHandles<Crdp.Debugger.BreakpointId>;
    private _sourceHandles: utils.ReverseHandles<ISourceContainer>;

    private _scriptsById: Map<Crdp.Runtime.ScriptId, CrdpScript>;
    private _scriptsByUrl: Map<string, CrdpScript>;
    private _pendingBreakpointsByUrl: Map<string, IPendingBreakpoint>;
    private _hitConditionBreakpointsById: Map<Crdp.Debugger.BreakpointId, IHitConditionBreakpoint>;

    private _lineColTransformer: LineColTransformer;
    protected _chromeConnection: ChromeConnection;
    protected _sourceMapTransformer: BaseSourceMapTransformer;
    protected _pathTransformer: BasePathTransformer;

    protected _hasTerminated: boolean;
    protected _inShutdown: boolean;
    protected _attachMode: boolean;
    protected _launchAttachArgs: ICommonRequestArgs;
    protected _port: number;
    private _blackboxedRegexes: RegExp[] = [];
    private _skipFileStatuses = new Map<string, boolean>();

    private _currentStep = Promise.resolve();
    private _currentLogMessage = Promise.resolve();
    private _nextUnboundBreakpointId = 0;
    private _pauseOnPromiseRejections = true;
    protected _promiseRejectExceptionFilterEnabled = false;

    private _columnBreakpointsEnabled: boolean;

    private _smartStepEnabled: boolean;
    private _smartStepCount = 0;
    private _earlyScripts: Crdp.Debugger.ScriptParsedEvent[] = [];

    private _initialSourceMapsP = Promise.resolve();

    private _lastPauseState: { expecting: ReasonType; event: Crdp.Debugger.PausedEvent };

    private _breakOnLoadHelper: BreakOnLoadHelper | null;

    // Queue to synchronize new source loaded and source removed events so that 'remove' script events
    // won't be send before the corresponding 'new' event has been sent
    private _sourceLoadedQueue: Promise<void> = Promise.resolve(null);

    // Promises so ScriptPaused events can wait for ScriptParsed events to finish resolving breakpoints
    private _scriptIdToBreakpointsAreResolvedDefer = new Map<string, PromiseDefer<void>>();

    private _batchTelemetryReporter: BatchTelemetryReporter;

    public readonly events: StepProgressEventsEmitter;

    private _loadedSourcesByScriptId = new Map<Crdp.Runtime.ScriptId, CrdpScript>();

    private _isVSClient: boolean;

    public constructor({ chromeConnection, lineColTransformer, sourceMapTransformer, pathTransformer, targetFilter, enableSourceMapCaching }: IChromeDebugAdapterOpts,
        session: ChromeDebugSession) {
        telemetry.setupEventHandler(e => session.sendEvent(e));
        this._batchTelemetryReporter = new BatchTelemetryReporter(telemetry);
        this._session = session;
        this._chromeConnection = new (chromeConnection || ChromeConnection)(undefined, targetFilter);
        this.events = new StepProgressEventsEmitter(this._chromeConnection.events ? [this._chromeConnection.events] : []);

        this._frameHandles = new Handles<Crdp.Debugger.CallFrame>();
        this._variableHandles = new variables.VariableHandles();
        this._breakpointIdHandles = new utils.ReverseHandles<Crdp.Debugger.BreakpointId>();
        this._sourceHandles = new utils.ReverseHandles<ISourceContainer>();
        this._pendingBreakpointsByUrl = new Map<string, IPendingBreakpoint>();
        this._hitConditionBreakpointsById = new Map<Crdp.Debugger.BreakpointId, IHitConditionBreakpoint>();

        this._lineColTransformer = new (lineColTransformer || LineColTransformer)(this._session);
        this._sourceMapTransformer = new (sourceMapTransformer || EagerSourceMapTransformer)(this._sourceHandles, enableSourceMapCaching);
        this._pathTransformer = new (pathTransformer || RemotePathTransformer)();

        this.clearTargetContext();
    }

    public get chrome(): Crdp.ProtocolApi {
        return this._chromeConnection.api;
    }

    public get scriptsById(): Map<Crdp.Runtime.ScriptId, CrdpScript> {
        return this._scriptsById;
    }

    public get pathTransformer(): BasePathTransformer {
        return this._pathTransformer;
    }

    public get pendingBreakpointsByUrl(): Map<string, IPendingBreakpoint> {
        return this._pendingBreakpointsByUrl;
    }

    public get committedBreakpointsByUrl(): Map<string, ISetBreakpointResult[]> {
        return this._committedBreakpointsByUrl;
    }

    public get sourceMapTransformer(): BaseSourceMapTransformer {
        return this._sourceMapTransformer;
    }

    /**
     * Called on 'clearEverything' or on a navigation/refresh
     */
    protected clearTargetContext(): void {
        this._sourceMapTransformer.clearTargetContext();

        this._scriptsById = new Map<Crdp.Runtime.ScriptId, Crdp.Debugger.ScriptParsedEvent>();
        this._scriptsByUrl = new Map<string, Crdp.Debugger.ScriptParsedEvent>();

        this._committedBreakpointsByUrl = new Map<string, ISetBreakpointResult[]>();
        this._setBreakpointsRequestQ = Promise.resolve();

        this._pathTransformer.clearTargetContext();
    }

    /* __GDPR__
        "ClientRequest/initialize" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public initialize(args: IInitializeRequestArgs): DebugProtocol.Capabilities {
        if (args.supportsMapURLToFilePathRequest) {
            this._pathTransformer = new FallbackToClientPathTransformer(this._session);
        }

        this._isVSClient = args.clientID === 'visualstudio';
        utils.setCaseSensitivePaths(!this._isVSClient);
        this._sourceMapTransformer.isVSClient = this._isVSClient;

        if (args.pathFormat !== 'path') {
            throw errors.pathFormat();
        }

        if (args.locale) {
            localize = nls.config({ locale: args.locale })();
        }

        // because session bypasses dispatchRequest
        if (typeof args.linesStartAt1 === 'boolean') {
            (<any>this)._clientLinesStartAt1 = args.linesStartAt1;
        }
        if (typeof args.columnsStartAt1 === 'boolean') {
            (<any>this)._clientColumnsStartAt1 = args.columnsStartAt1;
        }

        const exceptionBreakpointFilters = [
            {
                label: localize('exceptions.all', 'All Exceptions'),
                filter: 'all',
                default: false
            },
            {
                label: localize('exceptions.uncaught', 'Uncaught Exceptions'),
                filter: 'uncaught',
                default: false
            }
        ];
        if (this._promiseRejectExceptionFilterEnabled) {
            exceptionBreakpointFilters.push({
                label: localize('exceptions.promise_rejects', 'Promise Rejects'),
                filter: 'promise_reject',
                default: false
            });
        }

        // This debug adapter supports two exception breakpoint filters
        return {
            exceptionBreakpointFilters,
            supportsConfigurationDoneRequest: true,
            supportsSetVariable: true,
            supportsConditionalBreakpoints: true,
            supportsCompletionsRequest: true,
            supportsHitConditionalBreakpoints: true,
            supportsRestartFrame: true,
            supportsExceptionInfoRequest: true,
            supportsDelayedStackTraceLoading: true,
            supportsValueFormattingOptions: true,
            supportsEvaluateForHovers: true,
            supportsLoadedSourcesRequest: true
        };
    }

    /* __GDPR__
        "ClientRequest/configurationDone" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public configurationDone(): Promise<void> {
        return Promise.resolve();
    }

    public get breakOnLoadActive(): boolean {
        return !!this._breakOnLoadHelper;
    }

    /* __GDPR__
        "ClientRequest/launch" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async launch(args: ILaunchRequestArgs, telemetryPropertyCollector?: ITelemetryPropertyCollector): Promise<void> {
        this.commonArgs(args);

        if (args.pathMapping) {
            for (const urlToMap in args.pathMapping) {
                args.pathMapping[urlToMap] = utils.canonicalizeUrl(args.pathMapping[urlToMap]);
            }
        }

        this._sourceMapTransformer.launch(args);
        this._pathTransformer.launch(args);

        if (args.breakOnLoadStrategy && args.breakOnLoadStrategy !== 'off') {
            this._breakOnLoadHelper = new BreakOnLoadHelper(this, args.breakOnLoadStrategy);
        }

        if (!args.__restart) {
            /* __GDPR__
               "debugStarted" : {
                  "request" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
                  "args" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
                  "${include}": [ "${DebugCommonProperties}" ]
               }
            */
            telemetry.reportEvent('debugStarted', { request: 'launch', args: Object.keys(args) });
        }
    }

    /* __GDPR__
        "ClientRequest/attach" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async attach(args: IAttachRequestArgs): Promise<void> {
        this._attachMode = true;
        this.commonArgs(args);
        this._sourceMapTransformer.attach(args);
        this._pathTransformer.attach(args);

        if (!args.port) {
            args.port = 9229;
        }

        /* __GDPR__
            "debugStarted" : {
                "request" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
                "args" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
                "${include}": [ "${DebugCommonProperties}" ]
            }
        */
        telemetry.reportEvent('debugStarted', { request: 'attach', args: Object.keys(args) });
        await this.doAttach(args.port, args.url, args.address, args.timeout, args.websocketUrl, args.extraCRDPChannelPort);
    }

    protected commonArgs(args: ICommonRequestArgs): void {
        let logToFile = false;
        let logLevel: Logger.LogLevel;
        if (args.trace === 'verbose') {
            logLevel = Logger.LogLevel.Verbose;
            logToFile = true;
        } else if (args.trace) {
            logLevel = Logger.LogLevel.Warn;
            logToFile = true;
        } else {
            logLevel = Logger.LogLevel.Warn;
        }

        // The debug configuration provider should have set logFilePath on the launch config. If not, default to 'true' to use the
        // "legacy" log file path from the CDA subclass
        const logFilePath = args.logFilePath || logToFile;
        logger.setup(logLevel, logFilePath);

        this._launchAttachArgs = args;

        // Enable sourcemaps and async callstacks by default
        args.sourceMaps = typeof args.sourceMaps === 'undefined' || args.sourceMaps;

        this._smartStepEnabled = this._launchAttachArgs.smartStep;
    }

    public shutdown(): void {
        this._batchTelemetryReporter.finalize();
        this._inShutdown = true;
        this._session.shutdown();
    }

    protected async terminateSession(reason: string, disconnectArgs?: DebugProtocol.DisconnectArguments, restart?: IRestartRequestArgs): Promise<void> {
        logger.log(`Terminated: ${reason}`);

        if (!this._hasTerminated) {
            logger.log(`Waiting for any pending steps or log messages.`);
            await this._currentStep;
            await this._currentLogMessage;
            logger.log(`Current step and log messages complete`);

            /* __GDPR__
               "debugStopped" : {
                  "reason" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
                  "${include}": [ "${DebugCommonProperties}" ]
               }
             */
            telemetry.reportEvent('debugStopped', { reason });
            this._hasTerminated = true;
            if (this._clientAttached || (this._launchAttachArgs && (<ILaunchRequestArgs>this._launchAttachArgs).noDebug)) {
                this._session.sendEvent(new TerminatedEvent(restart));
            }

            if (this._chromeConnection.isAttached) {
                this._chromeConnection.close();
            }
        }
    }

    /**
     * Hook up all connection events
     */
    protected hookConnectionEvents(): void {
        this.chrome.Debugger.on('paused', params => {
            /* __GDPR__
               "target/notification/onPaused" : {
                  "${include}": [
                      "${IExecutionResultTelemetryProperties}",
                      "${DebugCommonProperties}"
                    ]
               }
             */
            this.runAndMeasureProcessingTime('target/notification/onPaused', async () => {
                await this.onPaused(params);
            });
        });
        this.chrome.Debugger.on('resumed', () => this.onResumed());
        this.chrome.Debugger.on('scriptParsed', params => {
            /* __GDPR__
               "target/notification/onScriptParsed" : {
                  "${include}": [
                        "${IExecutionResultTelemetryProperties}",
                        "${DebugCommonProperties}"
                    ]
               }
             */
            this.runAndMeasureProcessingTime('target/notification/onScriptParsed', () => {
                return this.onScriptParsed(params);
            });
        });
        this.chrome.Debugger.on('breakpointResolved', params => this.onBreakpointResolved(params));
        this.chrome.Console.on('messageAdded', params => this.onMessageAdded(params));
        this.chrome.Runtime.on('consoleAPICalled', params => this.onConsoleAPICalled(params));
        this.chrome.Runtime.on('exceptionThrown', params => this.onExceptionThrown(params));
        this.chrome.Runtime.on('executionContextsCleared', () => this.onExecutionContextsCleared());

        this._chromeConnection.onClose(() => this.terminateSession('websocket closed'));
    }

    private async runAndMeasureProcessingTime(notificationName: string, procedure: () => Promise<void>): Promise<void> {
        const startTime = Date.now();
        const startTimeMark = process.hrtime();
        let properties: IExecutionResultTelemetryProperties = {
            startTime: startTime.toString()
        };

        try {
            await procedure();
            properties.successful = 'true';
        } catch (e) {
            properties.successful = 'false';
            properties.exceptionType = 'firstChance';
            utils.fillErrorDetails(properties, e);
        }

        const elapsedTime = utils.calculateElapsedTime(startTimeMark);
        properties.timeTakenInMilliseconds = elapsedTime.toString();

        // Callers set GDPR annotation
        this._batchTelemetryReporter.reportEvent(notificationName, properties);
    }

    /**
     * Enable clients and run connection
     */
    protected runConnection(): Promise<void>[] {
        return [
            this.chrome.Console.enable()
                .catch(e => { /* Specifically ignore a fail here since it's only for backcompat */ }),
            utils.toVoidP(this.chrome.Debugger.enable()),
            this.chrome.Runtime.enable(),
            this._chromeConnection.run()
        ];
    }

    protected async doAttach(port: number, targetUrl?: string, address?: string, timeout?: number, websocketUrl?: string, extraCRDPChannelPort?: number): Promise<void> {
        /* __GDPR__FRAGMENT__
           "StepNames" : {
              "Attach" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
           }
         */
        this.events.emitStepStarted('Attach');
        // Client is attaching - if not attached to the chrome target, create a connection and attach
        this._clientAttached = true;
        if (!this._chromeConnection.isAttached) {
            if (websocketUrl) {
                await this._chromeConnection.attachToWebsocketUrl(websocketUrl, extraCRDPChannelPort);
            } else {
                await this._chromeConnection.attach(address, port, targetUrl, timeout, extraCRDPChannelPort);
            }

            /* __GDPR__FRAGMENT__
            "StepNames" : {
                "Attach.ConfigureDebuggingSession.Internal" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
            }
            */
            this.events.emitStepStarted('Attach.ConfigureDebuggingSession.Internal');

            this._port = port;

            this.hookConnectionEvents();
            let patterns: string[] = [];

            if (this._launchAttachArgs.skipFiles) {
                const skipFilesArgs = this._launchAttachArgs.skipFiles.filter(glob => {
                    if (glob.startsWith('!')) {
                        logger.warn(`Warning: skipFiles entries starting with '!' aren't supported and will be ignored. ("${glob}")`);
                        return false;
                    }

                    return true;
                });

                patterns = skipFilesArgs.map(glob => utils.pathGlobToBlackboxedRegex(glob));
            }

            if (this._launchAttachArgs.skipFileRegExps) {
                patterns = patterns.concat(this._launchAttachArgs.skipFileRegExps);
            }

            /* __GDPR__FRAGMENT__
               "StepNames" : {
                  "Attach.ConfigureDebuggingSession.Target" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
               }
             */
            this.events.emitStepStarted('Attach.ConfigureDebuggingSession.Target');

            // Make sure debugging domain is enabled before calling refreshBlackboxPatterns() below
            await Promise.all(this.runConnection());

            if (patterns.length) {
                this._blackboxedRegexes = patterns.map(pattern => new RegExp(pattern, 'i'));
                this.refreshBlackboxPatterns();
            }

            await this.initSupportedDomains();
            const maxDepth = this._launchAttachArgs.showAsyncStacks ? ChromeDebugAdapter.ASYNC_CALL_STACK_DEPTH : 0;
            try {
                await this.chrome.Debugger.setAsyncCallStackDepth({ maxDepth });
            } catch (e) {
                // Not supported by older runtimes, ignore it.
            }
        }
    }

    private async initSupportedDomains(): Promise<void> {
        try {
            const domainResponse = await this.chrome.Schema.getDomains();
            domainResponse.domains.forEach(domain => this._domains.set(<any>domain.name, domain));
        } catch (e) {
            // If getDomains isn't supported for some reason, skip this
        }
    }

    /**
     * This event tells the client to begin sending setBP requests, etc. Some consumers need to override this
     * to send it at a later time of their choosing.
     */
    protected async sendInitializedEvent(): Promise<void> {
        // Wait to finish loading sourcemaps from the initial scriptParsed events
        if (this._initialSourceMapsP) {
            const initialSourceMapsP = this._initialSourceMapsP;
            this._initialSourceMapsP = null;

            await initialSourceMapsP;

            this._session.sendEvent(new InitializedEvent());
            this.events.emitStepCompleted('NotifyInitialized');
            await Promise.all(this._earlyScripts.map(script => this.sendLoadedSourceEvent(script)));
            this._earlyScripts = null;
        }
    }

    public doAfterProcessingSourceEvents(action: () => void): Promise<void> {
        return this._sourceLoadedQueue = this._sourceLoadedQueue.then(action);
    }

    /**
     * e.g. the target navigated
     */
    protected onExecutionContextsCleared(): Promise<void> {
        const cachedScriptParsedEvents = Array.from(this._scriptsById.values());
        this.clearTargetContext();
        return this.doAfterProcessingSourceEvents(async () => { // This will not execute until all the on-flight 'new' source events have been processed
            for (let scriptedParseEvent of cachedScriptParsedEvents) {
                this.sendLoadedSourceEvent(scriptedParseEvent, 'removed');
            }
        });
    }

    protected async onPaused(notification: Crdp.Debugger.PausedEvent, expectingStopReason = this._expectingStopReason): Promise<IOnPausedResult> {
        if (notification.asyncCallStackTraceId) {
            await this.chrome.Debugger.pauseOnAsyncCall({ parentStackTraceId: notification.asyncCallStackTraceId });
            await this.chrome.Debugger.resume();
            return { didPause: false };
        }

        this._variableHandles.onPaused();
        this._frameHandles.reset();
        this._exception = undefined;
        this._lastPauseState = { event: notification, expecting: expectingStopReason };
        this._currentPauseNotification = notification;

        // If break on load is active, we pass the notification object to breakonload helper
        // If it returns true, we continue and return
        if (this.breakOnLoadActive) {
            let shouldContinue = await this._breakOnLoadHelper.handleOnPaused(notification);
            if (shouldContinue) {
                this.chrome.Debugger.resume()
                    .catch(e => {
                        logger.error('Failed to resume due to exception: ' + e.message);
                    });
                return { didPause: false };
            }
        }

        // We can tell when we've broken on an exception. Otherwise if hitBreakpoints is set, assume we hit a
        // breakpoint. If not set, assume it was a step. We can't tell the difference between step and 'break on anything'.
        let reason: ReasonType;
        let shouldSmartStep = false;
        if (notification.reason === 'exception') {
            reason = 'exception';
            this._exception = notification.data;
        } else if (notification.reason === 'promiseRejection') {
            reason = 'promise_rejection';

            // After processing smartStep and so on, check whether we are paused on a promise rejection, and should continue past it
            if (this._promiseRejectExceptionFilterEnabled && !this._pauseOnPromiseRejections) {
                this.chrome.Debugger.resume()
                    .catch(e => { /* ignore failures */ });
                return { didPause: false };
            }

            this._exception = notification.data;
        } else if (notification.hitBreakpoints && notification.hitBreakpoints.length) {
            reason = 'breakpoint';

            // Did we hit a hit condition breakpoint?
            for (let hitBp of notification.hitBreakpoints) {
                if (this._hitConditionBreakpointsById.has(hitBp)) {
                    // Increment the hit count and check whether to pause
                    const hitConditionBp = this._hitConditionBreakpointsById.get(hitBp);
                    hitConditionBp.numHits++;
                    // Only resume if we didn't break for some user action (step, pause button)
                    if (!expectingStopReason && !hitConditionBp.shouldPause(hitConditionBp.numHits)) {
                        this.chrome.Debugger.resume()
                            .catch(e => { /* ignore failures */ });
                        return { didPause: false };
                    }
                }
            }
        } else if (expectingStopReason) {
            // If this was a step, check whether to smart step
            reason = expectingStopReason;
            shouldSmartStep = await this.shouldSmartStep(this._currentPauseNotification.callFrames[0]);
        } else {
            reason = 'debugger_statement';
        }

        this._expectingStopReason = undefined;

        if (shouldSmartStep) {
            this._smartStepCount++;
            await this.stepIn(false);
            return { didPause: false };
        } else {
            if (this._smartStepCount > 0) {
                logger.log(`SmartStep: Skipped ${this._smartStepCount} steps`);
                this._smartStepCount = 0;
            }

            // Enforce that the stopped event is not fired until we've sent the response to the step that induced it.
            // Also with a timeout just to ensure things keep moving
            const sendStoppedEvent = () => {
                return this._session.sendEvent(new StoppedEvent2(reason, /*threadId=*/ChromeDebugAdapter.THREAD_ID, this._exception));
            };
            await utils.promiseTimeout(this._currentStep, /*timeoutMs=*/300)
                .then(sendStoppedEvent, sendStoppedEvent);

            return { didPause: true };
        }
    }

    /* __GDPR__
        "ClientRequest/exceptionInfo" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async exceptionInfo(args: DebugProtocol.ExceptionInfoArguments): Promise<IExceptionInfoResponseBody> {
        if (args.threadId !== ChromeDebugAdapter.THREAD_ID) {
            throw errors.invalidThread(args.threadId);
        }

        if (this._exception) {
            const isError = this._exception.subtype === 'error';
            const message = isError ? utils.firstLine(this._exception.description) : (this._exception.description || this._exception.value);
            const formattedMessage = message && message.replace(/\*/g, '\\*');
            const response: IExceptionInfoResponseBody = {
                exceptionId: this._exception.className || this._exception.type || 'Error',
                breakMode: 'unhandled',
                details: {
                    stackTrace: this._exception.description && await this.mapFormattedException(this._exception.description),
                    message,
                    formattedDescription: formattedMessage, // VS workaround - see https://github.com/Microsoft/vscode/issues/34259
                    typeName: this._exception.subtype || this._exception.type
                }
            };

            return response;
        } else {
            throw errors.noStoredException();
        }
    }

    private async shouldSmartStep(frame: Crdp.Debugger.CallFrame): Promise<boolean> {
        if (!this._smartStepEnabled) return Promise.resolve(false);

        const stackFrame = this.callFrameToStackFrame(frame);
        const clientPath = this._pathTransformer.getClientPathFromTargetPath(stackFrame.source.path) || stackFrame.source.path;
        const mapping = await this._sourceMapTransformer.mapToAuthored(clientPath, frame.location.lineNumber, frame.location.columnNumber);
        if (mapping) {
            return false;
        }

        if ((await this.sourceMapTransformer.allSources(clientPath)).length) {
            return true;
        }

        return false;
    }

    protected onResumed(): void {
        this._currentPauseNotification = null;

        if (this._expectingResumedEvent) {
            this._expectingResumedEvent = false;

            // Need to wait to eval just a little after each step, because of #148
            this._waitAfterStep = utils.promiseTimeout(null, 50);
        } else {
            let resumedEvent = new ContinuedEvent(ChromeDebugAdapter.THREAD_ID);
            this._session.sendEvent(resumedEvent);
        }
    }

    private async detectColumnBreakpointSupport(scriptId: Crdp.Runtime.ScriptId): Promise<void> {
        this._columnBreakpointsEnabled = false; // So it isn't requested multiple times
        try {
            await this.chrome.Debugger.getPossibleBreakpoints({
                start: { scriptId, lineNumber: 0, columnNumber: 0 },
                end: { scriptId, lineNumber: 1, columnNumber: 0 },
                restrictToFunction: false
            });
            this._columnBreakpointsEnabled = true;
        } catch (e) {
            this._columnBreakpointsEnabled = false;
        }

        this._lineColTransformer.columnBreakpointsEnabled = this._columnBreakpointsEnabled;
    }

    public getBreakpointsResolvedDefer(scriptId: string): PromiseDefer<void> {
        const existingValue =  this._scriptIdToBreakpointsAreResolvedDefer.get(scriptId);
        if (existingValue) {
            return existingValue;
        } else {
            const newValue = promiseDefer<void>();
            this._scriptIdToBreakpointsAreResolvedDefer.set(scriptId, newValue);
            return newValue;
        }
    }

    protected async onScriptParsed(script: Crdp.Debugger.ScriptParsedEvent): Promise<void> {
        // The stack trace and hash can be large and the DA doesn't need it.
        delete script.stackTrace;
        delete script.hash;

        const breakpointsAreResolvedDefer = this.getBreakpointsResolvedDefer(script.scriptId);
        try {
            this.doAfterProcessingSourceEvents(async () => { // This will block future 'removed' source events, until this processing has been completed
                if (typeof this._columnBreakpointsEnabled === 'undefined') {
                    await this.detectColumnBreakpointSupport(script.scriptId);
                    await this.sendInitializedEvent();
                }

                if (this._earlyScripts) {
                    this._earlyScripts.push(script);
                } else {
                    await this.sendLoadedSourceEvent(script);
                }
            });

            if (script.url) {
                script.url = utils.fixDriveLetter(script.url);
            } else {
                script.url = ChromeDebugAdapter.EVAL_NAME_PREFIX + script.scriptId;
            }

            this._scriptsById.set(script.scriptId, script);
            this._scriptsByUrl.set(utils.canonicalizeUrl(script.url), script);

            const mappedUrl = await this._pathTransformer.scriptParsed(script.url);

            const resolvePendingBPs = async (source: string) => {
                source = source && utils.canonicalizeUrl(source);
                const pendingBP = this._pendingBreakpointsByUrl.get(source);
                if (pendingBP && (!pendingBP.setWithPath || utils.canonicalizeUrl(pendingBP.setWithPath) === source)) {
                    logger.log(`OnScriptParsed.resolvePendingBPs: Resolving pending breakpoints: ${JSON.stringify(pendingBP)}`);
                    await this.resolvePendingBreakpoint(pendingBP);
                    this._pendingBreakpointsByUrl.delete(source);
                } else if (source) {
                    const sourceFileName = path.basename(source).toLowerCase();
                    if (Array.from(this._pendingBreakpointsByUrl.keys()).find(key => key.toLowerCase().indexOf(sourceFileName) > -1)) {
                        logger.log(`OnScriptParsed.resolvePendingBPs: The following pending breakpoints won't be resolved: ${JSON.stringify(pendingBP)} pendingBreakpointsByUrl = ${JSON.stringify([...this._pendingBreakpointsByUrl])} source = ${source}`);
                    }
                }
            };

            const sourceMapsP = this._sourceMapTransformer.scriptParsed(mappedUrl, script.sourceMapURL).then(async sources => {
                if (this._hasTerminated) {
                    return undefined;
                }

                if (sources) {
                    const filteredSources = sources.filter(source => source !== mappedUrl); // Tools like babel-register will produce sources with the same path as the generated script
                    for (const filteredSource of filteredSources) {
                        await resolvePendingBPs(filteredSource);
                    }
                }

                if (script.url === mappedUrl && this._pendingBreakpointsByUrl.has(mappedUrl) && this._pendingBreakpointsByUrl.get(mappedUrl).setWithPath === mappedUrl) {
                    // If the pathTransformer had no effect, and we attempted to set the BPs with that path earlier, then assume that they are about
                    // to be resolved in this loaded script, and remove the pendingBP.
                    this._pendingBreakpointsByUrl.delete(mappedUrl);
                } else {
                    await resolvePendingBPs(mappedUrl);
                }

                await this.resolveSkipFiles(script, mappedUrl, sources);
            });

            if (this._initialSourceMapsP) {
                this._initialSourceMapsP = <Promise<any>>Promise.all([this._initialSourceMapsP, sourceMapsP]);
            }
            await sourceMapsP;

            breakpointsAreResolvedDefer.resolve(); // By now no matter which code path we choose, resolving pending breakpoints should be finished, so trigger the defer
        } catch (exception) {
            breakpointsAreResolvedDefer.reject(exception);
        }
    }

    protected async sendLoadedSourceEvent(script: Crdp.Debugger.ScriptParsedEvent, loadedSourceEventReason: LoadedSourceEventReason = 'new'): Promise<void> {
        const source = await this.scriptToSource(script);

        // This is a workaround for an edge bug, see https://github.com/Microsoft/vscode-chrome-debug-core/pull/329
        switch (loadedSourceEventReason) {
            case 'new':
            case 'changed':
                if (this._loadedSourcesByScriptId.get(script.scriptId)) {
                    loadedSourceEventReason = 'changed';
                } else {
                    loadedSourceEventReason = 'new';
                }
                this._loadedSourcesByScriptId.set(script.scriptId, script);
                break;
            case 'removed':
                if (!this._loadedSourcesByScriptId.delete(script.scriptId)) {
                    telemetry.reportEvent('LoadedSourceEventError', { issue: 'Tried to remove non-existent script', scriptId: script.scriptId });
                    return;
                }
                break;
            default:
                telemetry.reportEvent('LoadedSourceEventError', { issue: 'Unknown reason', reason: loadedSourceEventReason });
        }

        const scriptEvent = new LoadedSourceEvent(loadedSourceEventReason, source as any);

        this._session.sendEvent(scriptEvent);
    }

    private async resolveSkipFiles(script: CrdpScript, mappedUrl: string, sources: string[], toggling?: boolean): Promise<void> {
        if (sources && sources.length) {
            const parentIsSkipped = this.shouldSkipSource(script.url);
            const libPositions: Crdp.Debugger.ScriptPosition[] = [];

            // Figure out skip/noskip transitions within script
            let inLibRange = parentIsSkipped;
            for (let s of sources) {
                let isSkippedFile = this.shouldSkipSource(s);
                if (typeof isSkippedFile !== 'boolean') {
                    // Inherit the parent's status
                    isSkippedFile = parentIsSkipped;
                }

                this._skipFileStatuses.set(s, isSkippedFile);

                if ((isSkippedFile && !inLibRange) || (!isSkippedFile && inLibRange)) {
                    const details = await this.sourceMapTransformer.allSourcePathDetails(mappedUrl);
                    const detail = details.find(d => d.inferredPath === s);
                    libPositions.push({
                        lineNumber: detail.startPosition.line,
                        columnNumber: detail.startPosition.column
                    });
                    inLibRange = !inLibRange;
                }
            }

            // If there's any change from the default, set proper blackboxed ranges
            if (libPositions.length || toggling) {
                if (parentIsSkipped) {
                    libPositions.splice(0, 0, { lineNumber: 0, columnNumber: 0});
                }

                if (libPositions[0].lineNumber !== 0 || libPositions[0].columnNumber !== 0) {
                    // The list of blackboxed ranges must start with 0,0 for some reason.
                    // https://github.com/Microsoft/vscode-chrome-debug/issues/667
                    libPositions[0] = {
                        lineNumber: 0,
                        columnNumber: 0
                    };
                }

                await this.chrome.Debugger.setBlackboxedRanges({
                    scriptId: script.scriptId,
                    positions: []
                }).catch(() => this.warnNoSkipFiles());

                if (libPositions.length) {
                    this.chrome.Debugger.setBlackboxedRanges({
                        scriptId: script.scriptId,
                        positions: libPositions
                    }).catch(() => this.warnNoSkipFiles());
                }
            }
        } else {
            const status = await this.getSkipStatus(mappedUrl);
            const skippedByPattern = this.matchesSkipFilesPatterns(mappedUrl);
            if (typeof status === 'boolean' && status !== skippedByPattern) {
                const positions = status ? [{ lineNumber: 0, columnNumber: 0 }] : [];
                this.chrome.Debugger.setBlackboxedRanges({
                    scriptId: script.scriptId,
                    positions
                }).catch(() => this.warnNoSkipFiles());
            }
        }
    }

    private warnNoSkipFiles(): void {
        logger.log('Warning: this runtime does not support skipFiles');
    }

    /**
     * If the source has a saved skip status, return that, whether true or false.
     * If not, check it against the patterns list.
     */
    private shouldSkipSource(sourcePath: string): boolean|undefined {
        const status = this.getSkipStatus(sourcePath);
        if (typeof status === 'boolean') {
            return status;
        }

        if (this.matchesSkipFilesPatterns(sourcePath)) {
            return true;
        }

        return undefined;
    }

    /**
     * Returns true if this path matches one of the static skip patterns
     */
    private matchesSkipFilesPatterns(sourcePath: string): boolean {
        return this._blackboxedRegexes.some(regex => {
            return regex.test(sourcePath);
        });
    }

    /**
     * Returns the current skip status for this path, which is either an authored or generated script.
     */
    private getSkipStatus(sourcePath: string): boolean|undefined {
        if (this._skipFileStatuses.has(sourcePath)) {
            return this._skipFileStatuses.get(sourcePath);
        }

        return undefined;
    }

    /* __GDPR__
        "ClientRequest/toggleSmartStep" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async toggleSmartStep(): Promise<void> {
        this._smartStepEnabled = !this._smartStepEnabled;
        this.onPaused(this._lastPauseState.event, this._lastPauseState.expecting);
    }

    /* __GDPR__
        "ClientRequest/toggleSkipFileStatus" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async toggleSkipFileStatus(args: IToggleSkipFileStatusArgs): Promise<void> {
        if (args.path) {
            args.path = utils.fileUrlToPath(args.path);
        }

        if (!await this.isInCurrentStack(args)) {
            // Only valid for files that are in the current stack
            const logName = args.path || this.displayNameForSourceReference(args.sourceReference);
            logger.log(`Can't toggle the skipFile status for ${logName} - it's not in the current stack.`);
            return;
        }

        // e.g. strip <node_internals>/
        if (args.path) {
            args.path = this.displayPathToRealPath(args.path);
        }

        const aPath = args.path || this.fakeUrlForSourceReference(args.sourceReference);
        const generatedPath = await this._sourceMapTransformer.getGeneratedPathFromAuthoredPath(aPath);
        if (!generatedPath) {
            logger.log(`Can't toggle the skipFile status for: ${aPath} - haven't seen it yet.`);
            return;
        }

        const sources = await this._sourceMapTransformer.allSources(generatedPath);
        if (generatedPath === aPath && sources.length) {
            // Ignore toggling skip status for generated scripts with sources
            logger.log(`Can't toggle skipFile status for ${aPath} - it's a script with a sourcemap`);
            return;
        }

        const newStatus = !this.shouldSkipSource(aPath);
        logger.log(`Setting the skip file status for: ${aPath} to ${newStatus}`);
        this._skipFileStatuses.set(aPath, newStatus);

        const targetPath = this._pathTransformer.getTargetPathFromClientPath(generatedPath) || generatedPath;
        const script = this.getScriptByUrl(targetPath);

        await this.resolveSkipFiles(script, generatedPath, sources, /*toggling=*/true);

        if (newStatus) {
            this.makeRegexesSkip(script.url);
        } else {
            this.makeRegexesNotSkip(script.url);
        }

        this.onPaused(this._lastPauseState.event, this._lastPauseState.expecting);
    }

    private async isInCurrentStack(args: IToggleSkipFileStatusArgs): Promise<boolean> {
        const currentStack = await this.stackTrace({ threadId: undefined });

        if (args.path) {
            return currentStack.stackFrames.some(frame => frame.source && frame.source.path === args.path);
        } else {
            return currentStack.stackFrames.some(frame => frame.source && frame.source.sourceReference === args.sourceReference);
        }
    }

    private makeRegexesNotSkip(noSkipPath: string): void {
        let somethingChanged = false;
        this._blackboxedRegexes = this._blackboxedRegexes.map(regex => {
            const result = utils.makeRegexNotMatchPath(regex, noSkipPath);
            somethingChanged = somethingChanged || (result !== regex);
            return result;
        });

        if (somethingChanged) {
            this.refreshBlackboxPatterns();
        }
    }

    private makeRegexesSkip(skipPath: string): void {
        let somethingChanged = false;
        this._blackboxedRegexes = this._blackboxedRegexes.map(regex => {
            const result = utils.makeRegexMatchPath(regex, skipPath);
            somethingChanged = somethingChanged || (result !== regex);
            return result;
        });

        if (!somethingChanged) {
            this._blackboxedRegexes.push(new RegExp(utils.pathToRegex(skipPath), 'i'));
        }

        this.refreshBlackboxPatterns();
    }

    private refreshBlackboxPatterns(): void {
        this.chrome.Debugger.setBlackboxPatterns({
            patterns: this._blackboxedRegexes.map(regex => regex.source)
        }).catch(() => this.warnNoSkipFiles());
    }

    /* __GDPR__
        "ClientRequest/loadedSources" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async loadedSources(args: DebugProtocol.LoadedSourcesArguments): Promise<IGetLoadedSourcesResponseBody> {
        const sources = await Promise.all(Array.from(this._scriptsByUrl.values())
            .map(script => this.scriptToSource(script)));

        return { sources: sources.sort((a, b) => a.path.localeCompare(b.path)) };
    }

    public resolvePendingBreakpoint(pendingBP: IPendingBreakpoint): Promise<void> {
        return this.setBreakpoints(pendingBP.args, null, pendingBP.requestSeq, pendingBP.ids).then(response => {
            response.breakpoints.forEach((bp, i) => {
                bp.id = pendingBP.ids[i];
                this._session.sendEvent(new BreakpointEvent('changed', bp));
            });
        });
    }

    protected onBreakpointResolved(params: Crdp.Debugger.BreakpointResolvedEvent): void {
        const script = this._scriptsById.get(params.location.scriptId);
        const breakpointId = this._breakpointIdHandles.lookup(params.breakpointId);
        if (!script || !breakpointId) {
            // Breakpoint resolved for a script we don't know about or a breakpoint we don't know about
            return;
        }

        // If the breakpoint resolved is a stopOnEntry breakpoint, we just return since we don't need to send it to client
        if (this.breakOnLoadActive && this._breakOnLoadHelper.stopOnEntryBreakpointIdToRequestedFileName.has(params.breakpointId)) {
            return;
        }

        const committedBps = this._committedBreakpointsByUrl.get(script.url) || [];
        if (!committedBps.find(committedBp => committedBp.breakpointId === params.breakpointId)) {
            committedBps.push({breakpointId: params.breakpointId, actualLocation: params.location});
        }
        this._committedBreakpointsByUrl.set(script.url, committedBps);

        const bp = <DebugProtocol.Breakpoint>{
            id: breakpointId,
            verified: true,
            line: params.location.lineNumber,
            column: params.location.columnNumber
        };
        const scriptPath = this._pathTransformer.breakpointResolved(bp, script.url);

        if (this._pendingBreakpointsByUrl.has(scriptPath)) {
            // If we set these BPs before the script was loaded, remove from the pending list
            this._pendingBreakpointsByUrl.delete(scriptPath);
        }
        this._sourceMapTransformer.breakpointResolved(bp, scriptPath);
        this._lineColTransformer.breakpointResolved(bp);
        this._session.sendEvent(new BreakpointEvent('changed', bp));
    }

    protected onConsoleAPICalled(event: Crdp.Runtime.ConsoleAPICalledEvent): void {
        if (this._launchAttachArgs._suppressConsoleOutput) {
            return;
        }

        const result = formatConsoleArguments(event);
        const stack = stackTraceWithoutLogpointFrame(event);
        if (result) {
            this.logObjects(result.args, result.isError, stack);
        }
    }

    private async logObjects(objs: Crdp.Runtime.RemoteObject[], isError = false, stackTrace?: Crdp.Runtime.StackTrace): Promise<void> {
        // This is an asynchronous method, so ensure that we handle one at a time so that they are sent out in the same order that they came in.
        this._currentLogMessage = this._currentLogMessage
            .then(async () => {
                const category = isError ? 'stderr' : 'stdout';

                // Shortcut the common log case to reduce unnecessary back and forth
                let e: DebugProtocol.OutputEvent;
                if (objs.length === 1 && objs[0].type === 'string') {
                    let msg = objs[0].value;
                    if (isError) {
                        msg = await this.mapFormattedException(msg);
                    }

                    e = new OutputEvent(msg + '\n', category);
                } else {
                    e = new OutputEvent('output', category);
                    e.body.variablesReference = this._variableHandles.create(new variables.LoggedObjects(objs), 'repl');
                }

                if (stackTrace && stackTrace.callFrames.length) {
                    const stackFrame = await this.mapCallFrame(stackTrace.callFrames[0]);
                    e.body.source = stackFrame.source;
                    e.body.line = stackFrame.line;
                    e.body.column = stackFrame.column;
                }

                this._session.sendEvent(e);
            })
            .catch(err => logger.error(err.toString()));
    }

    protected async onExceptionThrown(params: Crdp.Runtime.ExceptionThrownEvent): Promise<void> {
        if (this._launchAttachArgs._suppressConsoleOutput) {
            return;
        }

        return this._currentLogMessage = this._currentLogMessage.then(async () => {
            const formattedException = formatExceptionDetails(params.exceptionDetails);
            const exceptionStr = await this.mapFormattedException(formattedException);

            const e: DebugProtocol.OutputEvent = new OutputEvent(exceptionStr + '\n', 'stderr');
            const stackTrace = params.exceptionDetails.stackTrace;
            if (stackTrace && stackTrace.callFrames.length) {
                const stackFrame = await this.mapCallFrame(stackTrace.callFrames[0]);
                e.body.source = stackFrame.source;
                e.body.line = stackFrame.line;
                e.body.column = stackFrame.column;
            }

            this._session.sendEvent(e);
        })
        .catch(err => logger.error(err.toString()));
    }

    private async mapCallFrame(frame: Crdp.Runtime.CallFrame): Promise<DebugProtocol.StackFrame> {
        const debuggerCF = this.runtimeCFToDebuggerCF(frame);
        const stackFrame = this.callFrameToStackFrame(debuggerCF);
        await this._pathTransformer.fixSource(stackFrame.source);
        await this._sourceMapTransformer.fixSourceLocation(stackFrame);
        this._lineColTransformer.convertDebuggerLocationToClient(stackFrame);
        return stackFrame;
    }

    // We parse stack trace from `formattedException`, source map it and return a new string
    protected async mapFormattedException(formattedException: string): Promise<string> {
        const exceptionLines = formattedException.split(/\r?\n/);

        for (let i = 0, len = exceptionLines.length; i < len; ++i) {
            const line = exceptionLines[i];
            const matches = line.match(/^\s+at (.*?)\s*\(?([^ ]+):(\d+):(\d+)\)?$/);

            if (!matches) continue;
            const linePath = matches[2];
            const lineNum = parseInt(matches[3], 10);
            const adjustedLineNum = lineNum - 1;
            const columnNum = parseInt(matches[4], 10);
            const clientPath = this._pathTransformer.getClientPathFromTargetPath(linePath);
            const mapped = await this._sourceMapTransformer.mapToAuthored(clientPath || linePath, adjustedLineNum, columnNum);

            if (mapped && mapped.source && utils.isNumber(mapped.line) && utils.isNumber(mapped.column) && utils.existsSync(mapped.source)) {
                this._lineColTransformer.mappedExceptionStack(mapped);
                exceptionLines[i] = exceptionLines[i].replace(
                    `${linePath}:${lineNum}:${columnNum}`,
                    `${mapped.source}:${mapped.line}:${mapped.column}`);
            } else if (clientPath && clientPath !== linePath) {
                const location = { line: adjustedLineNum, column: columnNum };
                this._lineColTransformer.mappedExceptionStack(location);
                exceptionLines[i] = exceptionLines[i].replace(
                    `${linePath}:${lineNum}:${columnNum}`,
                    `${clientPath}:${location.line}:${location.column}`);
            }
        }

        return exceptionLines.join('\n');
    }

    /**
     * For backcompat, also listen to Console.messageAdded, only if it looks like the old format.
     */
    protected onMessageAdded(params: any): void {
        // message.type is undefined when Runtime.consoleAPICalled is being sent
        if (params && params.message && params.message.type) {
            const onConsoleAPICalledParams: Crdp.Runtime.ConsoleAPICalledEvent = {
                type: params.message.type,
                timestamp: params.message.timestamp,
                args: params.message.parameters || [{ type: 'string', value: params.message.text }],
                stackTrace: params.message.stack,
                executionContextId: 1
            };
            this.onConsoleAPICalled(onConsoleAPICalledParams);
        }
    }

    /* __GDPR__
        "ClientRequest/disconnect" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public disconnect(args: DebugProtocol.DisconnectArguments): void {
        telemetry.reportEvent('FullSessionStatistics/SourceMaps/Overrides', { aspNetClientAppFallbackCount: sourceMapUtils.getAspNetFallbackCount() });
        this.shutdown();
        this.terminateSession('Got disconnect request', args);
    }

    /* __GDPR__
        "ClientRequest/setBreakpoints" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public setBreakpoints(args: ISetBreakpointsArgs, _: ITelemetryPropertyCollector, requestSeq: number, ids?: number[]): Promise<ISetBreakpointsResponseBody> {
        this.reportBpTelemetry(args);
        if (args.source.path) {
            args.source.path = this.displayPathToRealPath(args.source.path);
            args.source.path = utils.fixDriveLetterAndSlashes(args.source.path);
        }

        return this.validateBreakpointsPath(args)
            .then(() => {
                // Deep copy the args that we are going to modify, and keep the original values in originalArgs
                const originalArgs = args;
                args = JSON.parse(JSON.stringify(args));
                args = this._lineColTransformer.setBreakpoints(args);
                const sourceMapTransformerResponse = this._sourceMapTransformer.setBreakpoints(args, requestSeq, ids);
                if (sourceMapTransformerResponse && sourceMapTransformerResponse.args) {
                    args = sourceMapTransformerResponse.args;
                }
                if (sourceMapTransformerResponse && sourceMapTransformerResponse.ids) {
                    ids = sourceMapTransformerResponse.ids;
                }
                args = this._pathTransformer.setBreakpoints(args);

                // Get the target url of the script
                let targetScriptUrl: string;
                if (args.source.sourceReference) {
                    const handle = this._sourceHandles.get(args.source.sourceReference);
                    if ((!handle || !handle.scriptId) && args.source.path) {
                        // A sourcemapped script with inline sources won't have a scriptId here, but the
                        // source.path has been fixed.
                        targetScriptUrl = args.source.path;
                    } else {
                        const targetScript = this._scriptsById.get(handle.scriptId);
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
                        .then(() => this.addBreakpoints(targetScriptUrl, internalBPs))
                        .then(responses => ({ breakpoints: this.targetBreakpointResponsesToBreakpointSetResults(targetScriptUrl, responses, internalBPs, ids) }));

                    const setBreakpointsPTimeout = utils.promiseTimeout(setBreakpointsPFailOnError, ChromeDebugAdapter.SET_BREAKPOINTS_TIMEOUT, localize('setBPTimedOut', 'Set breakpoints request timed out'));

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
                            // If all breakpoints are set, we mark them as set. If not, we mark them as un-set so they'll be set
                            const areAllSet = setBpResultBody.breakpoints.every(setBpResult => setBpResult.isSet);
                            // We need to send the original args to avoid adjusting the line and column numbers twice here
                            return this.unverifiedBpResponseForBreakpoints(originalArgs, requestSeq, targetScriptUrl, body.breakpoints, localize('bp.fail.unbound', 'Breakpoint set but not yet bound'), areAllSet);
                        }
                        this._sourceMapTransformer.setBreakpointsResponse(body, requestSeq);
                        this._lineColTransformer.setBreakpointsResponse(body);
                        return body;
                    });
                } else {
                    return Promise.resolve(this.unverifiedBpResponse(args, requestSeq, undefined, localize('bp.fail.noscript', "Can't find script for breakpoint request")));
                }
            },
            e => this.unverifiedBpResponse(args, requestSeq, undefined, e.message));
    }

    private reportBpTelemetry(args: ISetBreakpointsArgs): void {
        let fileExt = '';
        if (args.source.path) {
            fileExt = path.extname(args.source.path);
        }

        /* __GDPR__
           "setBreakpointsRequest" : {
              "fileExt" : { "classification": "CustomerContent", "purpose": "FeatureInsight" },
              "${include}": [ "${DebugCommonProperties}" ]
           }
         */
        telemetry.reportEvent('setBreakpointsRequest', { fileExt });
    }

    protected validateBreakpointsPath(args: ISetBreakpointsArgs): Promise<void> {
        if (!args.source.path || args.source.sourceReference) return Promise.resolve();

        // When break on load is active, we don't need to validate the path, so return
        if (this.breakOnLoadActive) {
            return Promise.resolve();
        }

        return this._sourceMapTransformer.getGeneratedPathFromAuthoredPath(args.source.path).then<void>(mappedPath => {

            if (!mappedPath) {
                return utils.errP(localize('validateBP.sourcemapFail', 'Breakpoint ignored because generated code not found (source map problem?).'));
            }

            const targetPath = this._pathTransformer.getTargetPathFromClientPath(mappedPath);
            if (!targetPath) {
                return utils.errP(localize('validateBP.notFound', 'Breakpoint ignored because target path not found'));
            }

            return undefined;
        });
    }

    private generateNextUnboundBreakpointId(): string {
        const unboundBreakpointUniquePrefix = '__::[vscode_chrome_debug_adapter_unbound_breakpoint]::';
        return `${unboundBreakpointUniquePrefix}${this._nextUnboundBreakpointId++}`;
    }

    private unverifiedBpResponse(args: ISetBreakpointsArgs, requestSeq: number, targetScriptUrl: string, message?: string, bpsSet = false): ISetBreakpointsResponseBody {
        const breakpoints = args.breakpoints.map(bp => {
            return <DebugProtocol.Breakpoint>{
                verified: false,
                line: bp.line,
                column: bp.column,
                message,
                id: this._breakpointIdHandles.create(this.generateNextUnboundBreakpointId())
            };
        });

        return this.unverifiedBpResponseForBreakpoints(args, requestSeq, targetScriptUrl, breakpoints, message, bpsSet);
    }

    private unverifiedBpResponseForBreakpoints(args: ISetBreakpointsArgs, requestSeq: number, targetScriptUrl: string, breakpoints: DebugProtocol.Breakpoint[], defaultMessage?: string, bpsSet = false): ISetBreakpointsResponseBody {
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
                { args, ids, requestSeq, setWithPath: targetScriptUrl });
        }

        return { breakpoints };
    }

    private clearAllBreakpoints(url: string): Promise<void> {
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

    /**
     * Makes the actual call to either Debugger.setBreakpoint or Debugger.setBreakpointByUrl, and returns the response.
     * Responses from setBreakpointByUrl are transformed to look like the response from setBreakpoint, so they can be
     * handled the same.
     */
    protected async addBreakpoints(url: string, breakpoints: InternalSourceBreakpoint[]): Promise<ISetBreakpointResult[]> {
        let responsePs: Promise<ISetBreakpointResult>[];
        if (ChromeUtils.isEvalScript(url)) {
            // eval script with no real url - use debugger_setBreakpoint
            const scriptId: Crdp.Runtime.ScriptId = utils.lstrip(url, ChromeDebugAdapter.EVAL_NAME_PREFIX);
            responsePs = breakpoints.map(({ line, column = 0, condition }, i) => this.chrome.Debugger.setBreakpoint({ location: { scriptId, lineNumber: line, columnNumber: column }, condition }));
        } else {
            // script that has a url - use debugger_setBreakpointByUrl so that Chrome will rebind the breakpoint immediately
            // after refreshing the page. This is the only way to allow hitting breakpoints in code that runs immediately when
            // the page loads.
            const script = this.getScriptByUrl(url);

            // If script has been parsed, script object won't be undefined and we would have the mapping file on the disk and we can directly set breakpoint using that
            if (!this.breakOnLoadActive || script) {
                const urlRegex = utils.pathToRegex(url);
                responsePs = breakpoints.map(({ line, column = 0, condition }, i) => {
                    return this.addOneBreakpointByUrl(script && script.scriptId, urlRegex, line, column, condition);
                });
            } else { // Else if script hasn't been parsed and break on load is active, we need to do extra processing
                if (this.breakOnLoadActive) {
                    return await this._breakOnLoadHelper.handleAddBreakpoints(url, breakpoints);
                }
            }
        }

        // Join all setBreakpoint requests to a single promise
        return Promise.all(responsePs);
    }

    private async addOneBreakpointByUrl(scriptId: Crdp.Runtime.ScriptId | undefined, urlRegex: string, lineNumber: number, columnNumber: number, condition: string): Promise<ISetBreakpointResult> {
        let bpLocation = { lineNumber, columnNumber };
        if (this._columnBreakpointsEnabled && scriptId) { // scriptId undefined when script not yet loaded, can't fix up column BP :(
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

    private targetBreakpointResponsesToBreakpointSetResults(url: string, responses: ISetBreakpointResult[], requestBps: InternalSourceBreakpoint[], ids?: number[]): BreakpointSetResult[] {
        // Don't cache errored responses
        const committedBps = responses
            .filter(response => response && response.breakpointId);

        // Cache successfully set breakpoint ids from chrome in committedBreakpoints set
        this._committedBreakpointsByUrl.set(url, committedBps);

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
        const result = ChromeDebugAdapter.HITCONDITION_MATCHER.exec(requestBp.hitCondition.trim());
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

    /* __GDPR__
        "ClientRequest/setExceptionBreakpoints" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments): Promise<void> {
        let state: 'all' | 'uncaught' | 'none';
        if (args.filters.indexOf('all') >= 0) {
            state = 'all';
        } else if (args.filters.indexOf('uncaught') >= 0) {
            state = 'uncaught';
        } else {
            state = 'none';
        }

        if (args.filters.indexOf('promise_reject') >= 0) {
            this._pauseOnPromiseRejections = true;
        } else {
            this._pauseOnPromiseRejections = false;
        }

        return this.chrome.Debugger.setPauseOnExceptions({ state })
            .then(() => { });
    }

    /* __GDPR__
        "ClientRequest/continue" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    /**
     * internal -> suppress telemetry
     */
    public continue(internal = false): Promise<void> {
       /* __GDPR__
          "continueRequest" : {
             "${include}": [ "${DebugCommonProperties}" ]
          }
        */
        if (!internal) telemetry.reportEvent('continueRequest');
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        this._expectingResumedEvent = true;
        return this._currentStep = this.chrome.Debugger.resume()
            .then(() => { /* make void */ },
                e => { /* ignore failures - client can send the request when the target is no longer paused */ });
    }

    /* __GDPR__
        "ClientRequest/next" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public next(): Promise<void> {
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        /* __GDPR__
           "nextRequest" : {
               "${include}": [ "${DebugCommonProperties}" ]
           }
         */
        telemetry.reportEvent('nextRequest');
        this._expectingStopReason = 'step';
        this._expectingResumedEvent = true;
        return this._currentStep = this.chrome.Debugger.stepOver()
            .then(() => { /* make void */ },
                e => { /* ignore failures - client can send the request when the target is no longer paused */ });
    }

    /* __GDPR__
        "ClientRequest/stepIn" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public stepIn(userInitiated = true): Promise<void> {
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        if (userInitiated) {
            /* __GDPR__
               "stepInRequest" : {
                  "${include}": [ "${DebugCommonProperties}" ]
               }
             */
            telemetry.reportEvent('stepInRequest');
        }

        this._expectingStopReason = 'step';
        this._expectingResumedEvent = true;
        return this._currentStep = this.chrome.Debugger.stepInto({ breakOnAsyncCall: true })
            .then(() => { /* make void */ },
                e => { /* ignore failures - client can send the request when the target is no longer paused */ });
    }

    /* __GDPR__
        "ClientRequest/stepOut" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public stepOut(): Promise<void> {
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        /* __GDPR__
           "stepOutRequest" : {
              "${include}": [ "${DebugCommonProperties}" ]
           }
         */
        telemetry.reportEvent('stepOutRequest');
        this._expectingStopReason = 'step';
        this._expectingResumedEvent = true;
        return this._currentStep = this.chrome.Debugger.stepOut()
            .then(() => { /* make void */ },
                e => { /* ignore failures - client can send the request when the target is no longer paused */ });
    }

    /* __GDPR__
        "ClientRequest/stepBack" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public stepBack(): Promise<void> {
        return (<TimeTravelRuntime>this.chrome).TimeTravel.stepBack()
            .then(() => { /* make void */ },
                e => { /* ignore failures - client can send the request when the target is no longer paused */ });
    }

    /* __GDPR__
        "ClientRequest/reverseContinue" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public reverseContinue(): Promise<void> {
        return (<TimeTravelRuntime>this.chrome).TimeTravel.reverse()
            .then(() => { /* make void */ },
                e => { /* ignore failures - client can send the request when the target is no longer paused */ });
    }

    /* __GDPR__
        "ClientRequest/pause" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public pause(): Promise<void> {
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        /* __GDPR__
           "pauseRequest" : {
              "${include}": [ "${DebugCommonProperties}" ]
           }
         */
        telemetry.reportEvent('pauseRequest');
        this._expectingStopReason = 'pause';
        return this._currentStep = this.chrome.Debugger.pause()
            .then(() => { });
    }

    /* __GDPR__
        "ClientRequest/stackTrace" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async stackTrace(args: DebugProtocol.StackTraceArguments): Promise<IStackTraceResponseBody> {
        if (!this._currentPauseNotification) {
            return Promise.reject(errors.noCallStackAvailable());
        }

        let stackFrames = this._currentPauseNotification.callFrames.map(frame => this.callFrameToStackFrame(frame))
            .concat(this.asyncFrames(this._currentPauseNotification.asyncStackTrace));

        const totalFrames = stackFrames.length;
        if (typeof args.startFrame === 'number') {
            stackFrames = stackFrames.slice(args.startFrame);
        }

        if (typeof args.levels === 'number') {
            stackFrames = stackFrames.slice(0, args.levels);
        }

        const stackTraceResponse: IInternalStackTraceResponseBody = {
            stackFrames,
            totalFrames
        };
        this._pathTransformer.stackTraceResponse(stackTraceResponse);
        await this._sourceMapTransformer.stackTraceResponse(stackTraceResponse);
        this._lineColTransformer.stackTraceResponse(stackTraceResponse);

        await Promise.all(stackTraceResponse.stackFrames.map(async (frame, i) => {
            // Remove isSourceMapped to convert back to DebugProtocol.StackFrame
            const isSourceMapped = frame.isSourceMapped;
            delete frame.isSourceMapped;

            if (!frame.source) {
                return;
            }

            // Apply hints to skipped frames
            const getSkipReason = reason => localize('skipReason', "(skipped by '{0}')", reason);
            if (frame.source.path && this.shouldSkipSource(frame.source.path)) {
                frame.source.origin = (frame.source.origin ? frame.source.origin + ' ' : '') + getSkipReason('skipFiles');
                frame.source.presentationHint = 'deemphasize';
            } else if (this._smartStepEnabled && !isSourceMapped) {
                frame.source.origin = (frame.source.origin ? frame.source.origin + ' ' : '') + getSkipReason('smartStep');
                frame.source.presentationHint = 'deemphasize';
            }

            // Allow consumer to adjust final path
            if (frame.source.path && frame.source.sourceReference) {
                frame.source.path = this.realPathToDisplayPath(frame.source.path);
            }

            // And finally, remove the fake eval path and fix the name, if it was never resolved to a real path
            if (frame.source.path && ChromeUtils.isEvalScript(frame.source.path)) {
                frame.source.path = undefined;
                frame.source.name = this.displayNameForSourceReference(frame.source.sourceReference);
            }

            // Format stackframe name
            frame.name = this.formatStackFrameName(frame, args.format);
        }));

        return stackTraceResponse;
    }

    private asyncFrames(stackTrace: Crdp.Runtime.StackTrace): DebugProtocol.StackFrame[] {
        if (stackTrace) {
            const frames = stackTrace.callFrames
                .map(frame => this.runtimeCFToDebuggerCF(frame))
                .map(frame => this.callFrameToStackFrame(frame));

            frames.unshift({
                id: this._frameHandles.create(null),
                name: `[ ${stackTrace.description} ]`,
                source: undefined,
                line: undefined,
                column: undefined,
                presentationHint: 'label'
            });

            return frames.concat(this.asyncFrames(stackTrace.parent));
        } else {
            return [];
        }
    }

    private runtimeCFToDebuggerCF(frame: Crdp.Runtime.CallFrame): Crdp.Debugger.CallFrame {
        return {
            callFrameId: undefined,
            scopeChain: undefined,
            this: undefined,
            location: {
                lineNumber: frame.lineNumber,
                columnNumber: frame.columnNumber,
                scriptId: frame.scriptId
            },
            url: frame.url,
            functionName: frame.functionName
        };
    }

    private async scriptToSource(script: Crdp.Debugger.ScriptParsedEvent): Promise<DebugProtocol.Source> {
        const sourceReference = this.getSourceReferenceForScriptId(script.scriptId);
        const origin = this.getReadonlyOrigin(script.url);

        const properlyCasedScriptUrl = utils.canonicalizeUrl(script.url);
        const displayPath = this.realPathToDisplayPath(properlyCasedScriptUrl);

        const exists = await utils.existsAsync(script.url);
        return <DebugProtocol.Source>{
            name: path.basename(displayPath),
            path: displayPath,
            // if the path exists, do not send the sourceReference
            sourceReference: exists ? undefined : sourceReference,
            origin
        };
    }

    private formatStackFrameName(frame: DebugProtocol.StackFrame, formatArgs?: DebugProtocol.StackFrameFormat): string {
        let formattedName = frame.name;
        if (formatArgs) {
            if (formatArgs.module) {
                formattedName += ` [${frame.source.name}]`;
            }

            if (formatArgs.line) {
                formattedName += ` Line ${frame.line}`;
            }
        }

        return formattedName;
    }

    private callFrameToStackFrame(frame: Crdp.Debugger.CallFrame): DebugProtocol.StackFrame {
        const { location, functionName } = frame;
        const line = location.lineNumber;
        const column = location.columnNumber;
        const script = this._scriptsById.get(location.scriptId);

        try {
            // When the script has a url and isn't one we're ignoring, send the name and path fields. PathTransformer will
            // attempt to resolve it to a script in the workspace. Otherwise, send the name and sourceReference fields.
            const sourceReference = this.getSourceReferenceForScriptId(script.scriptId);
            const origin = this.getReadonlyOrigin(script.url);
            const source: DebugProtocol.Source = {
                name: path.basename(script.url),
                path: script.url,
                sourceReference,
                origin
            };

            // If the frame doesn't have a function name, it's either an anonymous function
            // or eval script. If its source has a name, it's probably an anonymous function.
            const frameName = functionName || (script.url ? '(anonymous function)' : '(eval code)');
            return {
                id: this._frameHandles.create(frame),
                name: frameName,
                source,
                line,
                column
            };
        } catch (e) {
            // Some targets such as the iOS simulator behave badly and return nonsense callFrames.
            // In these cases, return a dummy stack frame
            const evalUnknown = `${ChromeDebugAdapter.EVAL_NAME_PREFIX}_Unknown`;
            return {
                id: this._frameHandles.create(<any>{ }),
                name: evalUnknown,
                source: { name: evalUnknown, path: evalUnknown },
                line,
                column
            };
        }
    }

    protected getReadonlyOrigin(url: string): string {
        // To override
        return undefined;
    }

    /**
     * Called when returning a stack trace, for the path for Sources that have a sourceReference, so consumers can
     * tweak it, since it's only for display.
     */
    protected realPathToDisplayPath(realPath: string): string {
        if (ChromeUtils.isEvalScript(realPath)) {
            return `${ChromeDebugAdapter.EVAL_ROOT}/${realPath}`;
        }

        return realPath;
    }

    protected displayPathToRealPath(displayPath: string): string {
        if (displayPath.startsWith(ChromeDebugAdapter.EVAL_ROOT)) {
            return displayPath.substr(ChromeDebugAdapter.EVAL_ROOT.length + 1); // Trim "<eval>/"
        }

        return displayPath;
    }

    /**
     * Get the existing handle for this script, identified by runtime scriptId, or create a new one
     */
    private getSourceReferenceForScriptId(scriptId: Crdp.Runtime.ScriptId): number {
        return this._sourceHandles.lookupF(container => container.scriptId === scriptId) ||
            this._sourceHandles.create({ scriptId });
    }

    /* __GDPR__
        "ClientRequest/scopes" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public scopes(args: DebugProtocol.ScopesArguments): IScopesResponseBody {
        const currentFrame = this._frameHandles.get(args.frameId);
        if (!currentFrame || !currentFrame.location || !currentFrame.callFrameId) {
            throw errors.stackFrameNotValid();
        }

        if (!currentFrame.callFrameId) {
            return { scopes: [] };
        }

        const currentScript = this._scriptsById.get(currentFrame.location.scriptId);
        const currentScriptUrl = currentScript && currentScript.url;
        const currentScriptPath = (currentScriptUrl && this._pathTransformer.getClientPathFromTargetPath(currentScriptUrl)) || currentScriptUrl;

        const scopes = currentFrame.scopeChain.map((scope: Crdp.Debugger.Scope, i: number) => {
            // The first scope should include 'this'. Keep the RemoteObject reference for use by the variables request
            const thisObj = i === 0 && currentFrame.this;
            const returnValue = i === 0 && currentFrame.returnValue;
            const variablesReference = this._variableHandles.create(
                new ScopeContainer(currentFrame.callFrameId, i, scope.object.objectId, thisObj, returnValue));

            const resultScope = <DebugProtocol.Scope>{
                name: scope.type.substr(0, 1).toUpperCase() + scope.type.substr(1), // Take Chrome's scope, uppercase the first letter
                variablesReference,
                expensive: scope.type === 'global'
            };

            if (scope.startLocation && scope.endLocation) {
                resultScope.column = scope.startLocation.columnNumber;
                resultScope.line = scope.startLocation.lineNumber;
                resultScope.endColumn = scope.endLocation.columnNumber;
                resultScope.endLine = scope.endLocation.lineNumber;
            }

            return resultScope;
        });

        if (this._exception && this.lookupFrameIndex(args.frameId) === 0) {
            scopes.unshift(<DebugProtocol.Scope>{
                name: localize('scope.exception', 'Exception'),
                variablesReference: this._variableHandles.create(ExceptionContainer.create(this._exception))
            });
        }

        const scopesResponse = { scopes };
        if (currentScriptPath) {
            this._sourceMapTransformer.scopesResponse(currentScriptPath, scopesResponse);
            this._lineColTransformer.scopeResponse(scopesResponse);
        }

        return scopesResponse;
    }

    /**
     * Try to lookup the index of the frame with given ID. Returns -1 for async frames and unknown frames.
     */
    private lookupFrameIndex(frameId: number): number {
        const currentFrame = this._frameHandles.get(frameId);
        if (!currentFrame || !currentFrame.callFrameId) {
            return -1;
        }

        return this._currentPauseNotification.callFrames.findIndex(frame => frame.callFrameId === currentFrame.callFrameId);
    }

    /* __GDPR__
        "ClientRequest/variables" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public variables(args: DebugProtocol.VariablesArguments): Promise<IVariablesResponseBody> {
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        const handle = this._variableHandles.get(args.variablesReference);
        if (!handle) {
            return Promise.resolve<IVariablesResponseBody>(undefined);
        }

        return handle.expand(this, args.filter, args.start, args.count)
            .catch(err => {
                logger.log('Error handling variables request: ' + err.toString());
                return [];
            }).then(variables => {
                return { variables };
            });
    }

    public async propertyDescriptorToVariable(propDesc: Crdp.Runtime.PropertyDescriptor, owningObjectId?: string, parentEvaluateName?: string): Promise<DebugProtocol.Variable> {
        if (propDesc.get) {
            // Getter
            const grabGetterValue = 'function remoteFunction(propName) { return this[propName]; }';

            let response: Crdp.Runtime.CallFunctionOnResponse;
            try {
                response = await this.chrome.Runtime.callFunctionOn({
                    objectId: owningObjectId,
                    functionDeclaration: grabGetterValue,
                    arguments: [{ value: propDesc.name }]
                });
            } catch (error) {
                logger.error(`Error evaluating getter for '${propDesc.name}' - ${error.toString()}`);
                return { name: propDesc.name, value: error.toString(), variablesReference: 0 };
            }

            if (response.exceptionDetails) {
                // Not an error, getter could be `get foo() { throw new Error('bar'); }`
                const exceptionMessage = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                logger.verbose('Exception thrown evaluating getter - ' + exceptionMessage);
                return { name: propDesc.name, value: exceptionMessage, variablesReference: 0 };
            } else {
                return this.remoteObjectToVariable(propDesc.name, response.result, parentEvaluateName);
            }
        } else if (propDesc.set) {
            // setter without a getter, unlikely
            return { name: propDesc.name, value: 'setter', variablesReference: 0 };
        } else {
            // Non getter/setter
            return this.internalPropertyDescriptorToVariable(propDesc, parentEvaluateName);
        }
    }

    public getVariablesForObjectId(objectId: string, evaluateName?: string, filter?: string, start?: number, count?: number): Promise<DebugProtocol.Variable[]> {
        if (typeof start === 'number' && typeof count === 'number') {
            return this.getFilteredVariablesForObject(objectId, evaluateName, filter, start, count);
        }

        filter = filter === 'indexed' ? 'all' : filter;

        return Promise.all([
            // Need to make two requests to get all properties
            this.getRuntimeProperties({ objectId, ownProperties: false, accessorPropertiesOnly: true, generatePreview: true }),
            this.getRuntimeProperties({ objectId, ownProperties: true, accessorPropertiesOnly: false, generatePreview: true })
        ]).then(getPropsResponses => {
            // Sometimes duplicates will be returned - merge all descriptors by name
            const propsByName = new Map<string, Crdp.Runtime.PropertyDescriptor>();
            const internalPropsByName = new Map<string, Crdp.Runtime.InternalPropertyDescriptor>();
            getPropsResponses.forEach(response => {
                if (response) {
                    response.result.forEach(propDesc =>
                        propsByName.set(propDesc.name, propDesc));

                    if (response.internalProperties) {
                        response.internalProperties.forEach(internalProp => {
                            internalPropsByName.set(internalProp.name, internalProp);
                        });
                    }
                }
            });

            // Convert Chrome prop descriptors to DebugProtocol vars
            const variables: Promise<DebugProtocol.Variable>[] = [];
            propsByName.forEach(propDesc => {
                if (!filter || filter === 'all' || (isIndexedPropName(propDesc.name) === (filter === 'indexed'))) {
                    variables.push(this.propertyDescriptorToVariable(propDesc, objectId, evaluateName));
                }
            });

            internalPropsByName.forEach(internalProp => {
                if (!filter || filter === 'all' || (isIndexedPropName(internalProp.name) === (filter === 'indexed'))) {
                    variables.push(Promise.resolve(this.internalPropertyDescriptorToVariable(internalProp, evaluateName)));
                }
            });

            return Promise.all(variables);
        }).then(variables => {
            // Sort all variables properly
            return variables.sort((var1, var2) => ChromeUtils.compareVariableNames(var1.name, var2.name));
        });
    }

    private getRuntimeProperties(params: Crdp.Runtime.GetPropertiesRequest): Promise<Crdp.Runtime.GetPropertiesResponse> {
        return this.chrome.Runtime.getProperties(params)
            .catch(err => {
                if (err.message.startsWith('Cannot find context with specified id')) {
                    // Hack to ignore this error until we fix https://github.com/Microsoft/vscode/issues/18001 to not request variables at unexpected times.
                    return null;
                } else {
                    throw err;
                }
            });
    }

    private internalPropertyDescriptorToVariable(propDesc: Crdp.Runtime.InternalPropertyDescriptor, parentEvaluateName: string): Promise<DebugProtocol.Variable> {
        return this.remoteObjectToVariable(propDesc.name, propDesc.value, parentEvaluateName);
    }

    private getFilteredVariablesForObject(objectId: string, evaluateName: string, filter: string, start: number, count: number): Promise<DebugProtocol.Variable[]> {
        // No ES6, in case we talk to an old runtime
        const getIndexedVariablesFn = `
            function getIndexedVariables(start, count) {
                var result = [];
                for (var i = start; i < (start + count); i++) result[i] = this[i];
                return result;
            }`;
        // TODO order??
        const getNamedVariablesFn = `
            function getNamedVariablesFn(start, count) {
                var result = [];
                var ownProps = Object.getOwnPropertyNames(this);
                for (var i = start; i < (start + count); i++) result[i] = ownProps[i];
                return result;
            }`;

        const getVarsFn = filter === 'indexed' ? getIndexedVariablesFn : getNamedVariablesFn;
        return this.getFilteredVariablesForObjectId(objectId, evaluateName, getVarsFn, filter, start, count);
    }

    private getFilteredVariablesForObjectId(objectId: string, evaluateName: string, getVarsFn: string, filter: string, start: number, count: number): Promise<DebugProtocol.Variable[]> {
        return this.chrome.Runtime.callFunctionOn({
            objectId,
            functionDeclaration: getVarsFn,
            arguments: [{ value: start }, { value: count }],
            silent: true
        }).then<DebugProtocol.Variable[]>(evalResponse => {
            if (evalResponse.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(evalResponse.exceptionDetails);
                return Promise.reject(errors.errorFromEvaluate(errMsg));
            } else {
                // The eval was successful and returned a reference to the array object. Get the props, then filter
                // out everything except the index names.
                return this.getVariablesForObjectId(evalResponse.result.objectId, evaluateName, filter)
                    .then(variables => variables.filter(variable => isIndexedPropName(variable.name)));
            }
        },
        error => Promise.reject(errors.errorFromEvaluate(error.message)));
    }

    /* __GDPR__
        "ClientRequest/source" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public source(args: DebugProtocol.SourceArguments): Promise<ISourceResponseBody> {
        let scriptId: Crdp.Runtime.ScriptId;
        if (args.sourceReference) {
            const handle = this._sourceHandles.get(args.sourceReference);
            if (!handle) {
                return Promise.reject(errors.sourceRequestIllegalHandle());
            }

            // Have inlined content?
            if (handle.contents) {
                return Promise.resolve({
                    content: handle.contents
                });
            }

            scriptId = handle.scriptId;
        } else if (args.source && args.source.path) {
            const realPath = this.displayPathToRealPath(args.source.path);

            // Request url has chars unescaped, but they will be escaped in scriptsByUrl
            const script = this.getScriptByUrl(
                utils.isURL(realPath) ?
                    encodeURI(realPath) :
                    realPath);

            if (!script) {
                return Promise.reject(errors.sourceRequestCouldNotRetrieveContent());
            }

            scriptId = script.scriptId;
        }

        if (!scriptId) {
            return Promise.reject(errors.sourceRequestCouldNotRetrieveContent());
        }

        // If not, should have scriptId
        return this.chrome.Debugger.getScriptSource({ scriptId }).then(response => {
            return {
                content: response.scriptSource,
                mimeType: 'text/javascript'
            };
        });
    }

    /* __GDPR__
        "ClientRequest/threads" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public threads(): IThreadsResponseBody {
        return {
            threads: [
                {
                    id: ChromeDebugAdapter.THREAD_ID,
                    name: this.threadName()
                }
            ]
        };
    }

    protected threadName(): string {
        return 'Thread ' + ChromeDebugAdapter.THREAD_ID;
    }

    /* __GDPR__
        "ClientRequest/evaluate" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async evaluate(args: DebugProtocol.EvaluateArguments): Promise<IEvaluateResponseBody> {
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        if (args.expression.startsWith(ChromeDebugAdapter.SCRIPTS_COMMAND)) {
            return this.handleScriptsCommand(args);
        }

        if (args.expression.startsWith('{') && args.expression.endsWith('}')) {
            args.expression = `(${args.expression})`;
        }

        const evalResponse = await this.waitThenDoEvaluate(args.expression, args.frameId, { generatePreview: true });

        // Convert to a Variable object then just copy the relevant fields off
        const variable = await this.remoteObjectToVariable(args.expression, evalResponse.result, /*parentEvaluateName=*/undefined, /*stringify=*/undefined, <VariableContext>args.context);
        if (evalResponse.exceptionDetails) {
            let resultValue = variable.value;
            if (resultValue && (resultValue.startsWith('ReferenceError: ') || resultValue.startsWith('TypeError: ')) && args.context !== 'repl') {
                resultValue = errors.evalNotAvailableMsg;
            }

            return utils.errP(resultValue);
        }

        return <IEvaluateResponseBody>{
            result: variable.value,
            variablesReference: variable.variablesReference,
            indexedVariables: variable.indexedVariables,
            namedVariables: variable.namedVariables,
            type: variable.type
        };
    }

    /**
     * Handle the .scripts command, which can be used as `.scripts` to return a list of all script details,
     * or `.scripts <url>` to show the contents of the given script.
     */
    private handleScriptsCommand(args: DebugProtocol.EvaluateArguments): Promise<IEvaluateResponseBody> {
        let outputStringP: Promise<string>;
        const scriptsRest = utils.lstrip(args.expression, ChromeDebugAdapter.SCRIPTS_COMMAND).trim();
        if (scriptsRest) {
            // `.scripts <url>` was used, look up the script by url
            const requestedScript = this.getScriptByUrl(scriptsRest);
            if (requestedScript) {
                outputStringP = this.chrome.Debugger.getScriptSource({ scriptId: requestedScript.scriptId })
                    .then(result => {
                        const maxLength = 1e5;
                        return result.scriptSource.length > maxLength ?
                            result.scriptSource.substr(0, maxLength) + '[⋯]' :
                            result.scriptSource;
                    });
            } else {
                outputStringP = Promise.resolve(`No runtime script with url: ${scriptsRest}\n`);
            }
        } else {
            outputStringP = this.getAllScriptsString();
        }

        return outputStringP.then(scriptsStr => {
            this._session.sendEvent(new OutputEvent(scriptsStr));
            return <IEvaluateResponseBody>{
                result: '',
                variablesReference: 0
            };
        });
    }

    private getAllScriptsString(): Promise<string> {
        const runtimeScripts = Array.from(this._scriptsByUrl.keys())
            .sort();
        return Promise.all(runtimeScripts.map(script => this.getOneScriptString(script))).then(strs => {
            return strs.join('\n');
        });
    }

    private getOneScriptString(runtimeScriptPath: string): Promise<string> {
        let result = '› ' + runtimeScriptPath;
        const clientPath = this._pathTransformer.getClientPathFromTargetPath(runtimeScriptPath);
        if (clientPath && clientPath !== runtimeScriptPath) result += ` (${clientPath})`;

        return this._sourceMapTransformer.allSourcePathDetails(clientPath || runtimeScriptPath).then(sourcePathDetails => {
            let mappedSourcesStr = sourcePathDetails.map(details => `    - ${details.originalPath} (${details.inferredPath})`).join('\n');
            if (sourcePathDetails.length) mappedSourcesStr = '\n' + mappedSourcesStr;

            return result + mappedSourcesStr;
        });
    }

    /**
     * Allow consumers to override just because of https://github.com/nodejs/node/issues/8426
     */
    protected globalEvaluate(args: Crdp.Runtime.EvaluateRequest): Promise<Crdp.Runtime.EvaluateResponse> {
        return this.chrome.Runtime.evaluate(args);
    }

    private async waitThenDoEvaluate(expression: string, frameId?: number, extraArgs?: Partial<Crdp.Runtime.EvaluateRequest>): Promise<Crdp.Debugger.EvaluateOnCallFrameResponse | Crdp.Runtime.EvaluateResponse> {
        const waitThenEval = this._waitAfterStep.then(() => this.doEvaluate(expression, frameId, extraArgs));
        this._waitAfterStep = waitThenEval.then(() => { }, () => { }); // to Promise<void> and handle failed evals
        return waitThenEval;
    }

    private async doEvaluate(expression: string, frameId?: number, extraArgs?: Partial<Crdp.Runtime.EvaluateRequest>): Promise<Crdp.Debugger.EvaluateOnCallFrameResponse | Crdp.Runtime.EvaluateResponse> {
        if (typeof frameId === 'number') {
            const frame = this._frameHandles.get(frameId);
            if (!frame || !frame.callFrameId) {
                return utils.errP(errors.evalNotAvailableMsg);
            }

            return this.evaluateOnCallFrame(expression, frame, extraArgs);
        } else {
            let args: Crdp.Runtime.EvaluateRequest = {
                expression,
                // silent because of an issue where node will sometimes hang when breaking on exceptions in console messages. Fixed somewhere between 8 and 8.4
                silent: true,
                includeCommandLineAPI: true,
                objectGroup: 'console',
                userGesture: true
            };
            if (extraArgs) {
                args = Object.assign(args, extraArgs);
            }

            return this.globalEvaluate(args);
        }
    }

    protected async evaluateOnCallFrame(expression: string, frame: Crdp.Debugger.CallFrame, extraArgs?: Partial<Crdp.Runtime.EvaluateRequest>): Promise<Crdp.Debugger.EvaluateOnCallFrameResponse | Crdp.Runtime.EvaluateResponse> {
        const callFrameId = frame.callFrameId;
        let args: Crdp.Debugger.EvaluateOnCallFrameRequest = {
            callFrameId,
            expression,
            // silent because of an issue where node will sometimes hang when breaking on exceptions in console messages. Fixed somewhere between 8 and 8.4
            silent: true,
            includeCommandLineAPI: true,
            objectGroup: 'console'
        };
        if (extraArgs) {
            args = Object.assign(args, extraArgs);
        }

        return this.chrome.Debugger.evaluateOnCallFrame(args);
    }

    /* __GDPR__
        "ClientRequest/setVariable" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public setVariable(args: DebugProtocol.SetVariableArguments): Promise<ISetVariableResponseBody> {
        const handle = this._variableHandles.get(args.variablesReference);
        if (!handle) {
            return Promise.reject(errors.setValueNotSupported());
        }

        return handle.setValue(this, args.name, args.value)
            .then(value => ({ value }));
    }

    public setVariableValue(callFrameId: string, scopeNumber: number, variableName: string, value: string): Promise<string> {
        let evalResultObject: Crdp.Runtime.RemoteObject;
        return this.chrome.Debugger.evaluateOnCallFrame({ callFrameId, expression: value, silent: true }).then(evalResponse => {
            if (evalResponse.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(evalResponse.exceptionDetails);
                return Promise.reject(errors.errorFromEvaluate(errMsg));
            } else {
                evalResultObject = evalResponse.result;
                const newValue = ChromeUtils.remoteObjectToCallArgument(evalResultObject);
                return this.chrome.Debugger.setVariableValue({ callFrameId, scopeNumber, variableName, newValue });
            }
        },
        error => Promise.reject(errors.errorFromEvaluate(error.message)))
        // Temporary, Microsoft/vscode#12019
        .then(setVarResponse => ChromeUtils.remoteObjectToValue(evalResultObject).value);
    }

    public setPropertyValue(objectId: string, propName: string, value: string): Promise<string> {
        const setPropertyValueFn = `function() { return this["${propName}"] = ${value} }`;
        return this.chrome.Runtime.callFunctionOn({
            objectId, functionDeclaration: setPropertyValueFn,
            silent: true
        }).then(response => {
            if (response.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                return Promise.reject<string>(errors.errorFromEvaluate(errMsg));
            } else {
                // Temporary, Microsoft/vscode#12019
                return ChromeUtils.remoteObjectToValue(response.result).value;
            }
        },
        error => Promise.reject<string>(errors.errorFromEvaluate(error.message)));
    }

    public async remoteObjectToVariable(name: string, object: Crdp.Runtime.RemoteObject, parentEvaluateName?: string, stringify = true, context: VariableContext = 'variables'): Promise<DebugProtocol.Variable> {
        name = name || '""';

        if (object) {
            if (object.type === 'object') {
                return this.createObjectVariable(name, object, parentEvaluateName, context);
            } else if (object.type === 'function') {
                return this.createFunctionVariable(name, object, context, parentEvaluateName);
            } else {
                return this.createPrimitiveVariable(name, object, parentEvaluateName, stringify);
            }
        } else {
            return this.createPrimitiveVariableWithValue(name, '', parentEvaluateName);
        }
    }

    public createFunctionVariable(name: string, object: Crdp.Runtime.RemoteObject, context: VariableContext, parentEvaluateName?: string): DebugProtocol.Variable {
        let value: string;
        const firstBraceIdx = object.description.indexOf('{');
        if (firstBraceIdx >= 0) {
            value = object.description.substring(0, firstBraceIdx) + '{ … }';
        } else {
            const firstArrowIdx = object.description.indexOf('=>');
            value = firstArrowIdx >= 0 ?
                object.description.substring(0, firstArrowIdx + 2) + ' …' :
                object.description;
        }

        const evaluateName = ChromeUtils.getEvaluateName(parentEvaluateName, name);
        return <DebugProtocol.Variable>{
            name,
            value,
            type: utils.uppercaseFirstLetter(object.type),
            variablesReference: this._variableHandles.create(new PropertyContainer(object.objectId, evaluateName), context),
            evaluateName
        };
    }

    public createObjectVariable(name: string, object: Crdp.Runtime.RemoteObject, parentEvaluateName: string, context: VariableContext): Promise<DebugProtocol.Variable> {
        if ((<string>object.subtype) === 'internal#location') {
            // Could format this nicely later, see #110
            return Promise.resolve(this.createPrimitiveVariableWithValue(name, 'internal#location', parentEvaluateName));
        } else if (object.subtype === 'null') {
            return Promise.resolve(this.createPrimitiveVariableWithValue(name, 'null', parentEvaluateName));
        }

        const value = variables.getRemoteObjectPreview_object(object, context);
        let propCountP: Promise<IPropCount>;
        if (object.subtype === 'array' || object.subtype === 'typedarray') {
            if (object.preview && !object.preview.overflow) {
                propCountP = Promise.resolve(this.getArrayNumPropsByPreview(object));
            } else if (object.className === 'Buffer') {
                propCountP = this.getBufferNumPropsByEval(object.objectId);
            } else {
                propCountP = this.getArrayNumPropsByEval(object.objectId);
            }
        } else if (object.subtype === 'set' || object.subtype === 'map') {
            if (object.preview && !object.preview.overflow) {
                propCountP = Promise.resolve(this.getCollectionNumPropsByPreview(object));
            } else {
                propCountP = this.getCollectionNumPropsByEval(object.objectId);
            }
        } else {
            propCountP = Promise.resolve({
                indexedVariables: undefined,
                namedVariables: undefined
             });
        }

        const evaluateName = ChromeUtils.getEvaluateName(parentEvaluateName, name);
        const variablesReference = this._variableHandles.create(this.createPropertyContainer(object, evaluateName), context);
        return propCountP.then(({ indexedVariables, namedVariables }) => (<DebugProtocol.Variable>{
            name,
            value,
            type: utils.uppercaseFirstLetter(object.type),
            variablesReference,
            indexedVariables,
            namedVariables,
            evaluateName
        }));
    }

    protected createPropertyContainer(object: Crdp.Runtime.RemoteObject, evaluateName: string): IVariableContainer {
        return new PropertyContainer(object.objectId, evaluateName);
    }

    public createPrimitiveVariable(name: string, object: Crdp.Runtime.RemoteObject, parentEvaluateName?: string, stringify?: boolean): DebugProtocol.Variable {
        const value = variables.getRemoteObjectPreview_primitive(object, stringify);
        const variable = this.createPrimitiveVariableWithValue(name, value, parentEvaluateName);
        variable.type = object.type;

        return variable;
    }

    public createPrimitiveVariableWithValue(name: string, value: string, parentEvaluateName?: string): DebugProtocol.Variable {
        return {
            name,
            value,
            variablesReference: 0,
            evaluateName: ChromeUtils.getEvaluateName(parentEvaluateName, name)
        };
    }

    /* __GDPR__
        "ClientRequest/restartFrame" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async restartFrame(args: DebugProtocol.RestartFrameArguments): Promise<void> {
        const callFrame = this._frameHandles.get(args.frameId);
        if (!callFrame || !callFrame.callFrameId) {
            return utils.errP(errors.noRestartFrame);
        }

        await this.chrome.Debugger.restartFrame({ callFrameId: callFrame.callFrameId });
        this._expectingStopReason = 'frame_entry';
        return this.chrome.Debugger.stepInto({ });
    }

    /* __GDPR__
        "ClientRequest/completions" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async completions(args: DebugProtocol.CompletionsArguments): Promise<ICompletionsResponseBody> {
        const text = args.text;
        const column = args.column;

        // 1-indexed column
        const prefix = text.substring(0, column - 1);

        let expression: string;
        const dot = prefix.lastIndexOf('.');
        if (dot >= 0) {
            expression = prefix.substr(0, dot);
        }

        if (typeof args.frameId === 'number' && !expression) {
            logger.verbose(`Completions: Returning global completions`);

            // If no expression was passed, we must be getting global completions at a breakpoint
            if (!this._frameHandles.get(args.frameId)) {
                return Promise.reject(errors.stackFrameNotValid());
            }

            const callFrame = this._frameHandles.get(args.frameId);
            if (!callFrame || !callFrame.callFrameId) {
                // Async frame or label
                return { targets: [] };
            }

            const scopeExpandPs = callFrame.scopeChain
                .map(scope => new ScopeContainer(callFrame.callFrameId, undefined, scope.object.objectId).expand(this));
            return Promise.all(scopeExpandPs)
                .then((variableArrs: DebugProtocol.Variable[][]) => {
                    const targets = this.getFlatAndUniqueCompletionItems(
                        variableArrs.map(variableArr => variableArr.map(variable => variable.name)));
                    return { targets };
                });
        } else {
            expression = expression || 'this';

            logger.verbose(`Completions: Returning for expression '${expression}'`);
            const getCompletionsFn = `(function(x){var a=[];for(var o=x;o!==null&&typeof o !== 'undefined';o=o.__proto__){a.push(Object.getOwnPropertyNames(o))};return a})(${expression})`;
            const response = await this.waitThenDoEvaluate(getCompletionsFn, args.frameId, { returnByValue: true });
            if (response.exceptionDetails) {
                return { targets: [] };
            } else {
                return { targets: this.getFlatAndUniqueCompletionItems(response.result.value) };
            }
        }
    }

    private getFlatAndUniqueCompletionItems(arrays: string[][]): DebugProtocol.CompletionItem[] {
        const set = new Set<string>();
        const items: DebugProtocol.CompletionItem[] = [];

        for (let i = 0; i < arrays.length; i++) {
            for (let name of arrays[i]) {
                if (!isIndexedPropName(name) && !set.has(name)) {
                    set.add(name);
                    items.push({
                        label: <string>name,
                        type: 'property'
                    });
                }
            }
        }

        return items;
    }

    private getArrayNumPropsByEval(objectId: string): Promise<IPropCount> {
        // +2 for __proto__ and length
        const getNumPropsFn = `function() { return [this.length, Object.keys(this).length - this.length + 2]; }`;
        return this.getNumPropsByEval(objectId, getNumPropsFn);
    }

    private getBufferNumPropsByEval(objectId: string): Promise<IPropCount> {
        // +2 for __proto__ and length
        // Object.keys doesn't return other props from a Buffer
        const getNumPropsFn = `function() { return [this.length, 0]; }`;
        return this.getNumPropsByEval(objectId, getNumPropsFn);
    }

    private getArrayNumPropsByPreview(object: Crdp.Runtime.RemoteObject): IPropCount {
        let indexedVariables = 0;
        const indexedProps = object.preview.properties
            .filter(prop => isIndexedPropName(prop.name));
        if (indexedProps.length) {
            // +1 because (last index=0) => 1 prop
            indexedVariables = parseInt(indexedProps[indexedProps.length - 1].name, 10) + 1;
        }

        const namedVariables = object.preview.properties.length - indexedProps.length + 2; // 2 for __proto__ and length
        return { indexedVariables, namedVariables };
    }

    private getCollectionNumPropsByEval(objectId: string): Promise<IPropCount> {
        const getNumPropsFn = `function() { return [0, Object.keys(this).length + 1]; }`; // +1 for [[Entries]];
        return this.getNumPropsByEval(objectId, getNumPropsFn);
    }

    private getCollectionNumPropsByPreview(object: Crdp.Runtime.RemoteObject): IPropCount {
        let indexedVariables = 0;
        let namedVariables = object.preview.properties.length + 1; // +1 for [[Entries]];

        return { indexedVariables, namedVariables };
    }

    private getNumPropsByEval(objectId: string, getNumPropsFn: string): Promise<IPropCount> {
        return this.chrome.Runtime.callFunctionOn({
            objectId,
            functionDeclaration: getNumPropsFn,
            silent: true,
            returnByValue: true
        }).then(response => {
            if (response.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                return Promise.reject<IPropCount>(errors.errorFromEvaluate(errMsg));
            } else {
                const resultProps = response.result.value;
                if (resultProps.length !== 2) {
                    return Promise.reject<IPropCount>(errors.errorFromEvaluate('Did not get expected props, got ' + JSON.stringify(resultProps)));
                }

                return { indexedVariables: resultProps[0], namedVariables: resultProps[1] };
            }
        },
        error => Promise.reject<IPropCount>(errors.errorFromEvaluate(error.message)));
    }

    private fakeUrlForSourceReference(sourceReference: number): string {
        const handle = this._sourceHandles.get(sourceReference);
        return `${ChromeDebugAdapter.EVAL_NAME_PREFIX}${handle.scriptId}`;
    }

    private displayNameForSourceReference(sourceReference: number): string {
        const handle = this._sourceHandles.get(sourceReference);
        return (handle && this.displayNameForScriptId(handle.scriptId)) || sourceReference + '';
    }

    private displayNameForScriptId(scriptId: number|string): string {
        return `${ChromeDebugAdapter.EVAL_NAME_PREFIX}${scriptId}`;
    }

    private getScriptByUrl(url: string): Crdp.Debugger.ScriptParsedEvent {
        url = utils.canonicalizeUrl(url);
        return this._scriptsByUrl.get(url) || this._scriptsByUrl.get(utils.fixDriveLetter(url));
    }
}
