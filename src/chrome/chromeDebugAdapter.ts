/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { InitializedEvent, TerminatedEvent, ContinuedEvent, OutputEvent, Logger, logger, LoadedSourceEvent } from 'vscode-debugadapter';

import { ICommonRequestArgs, ILaunchRequestArgs, ISetBreakpointsArgs, ISetBreakpointsResponseBody, IStackTraceResponseBody,
    IAttachRequestArgs, IScopesResponseBody, IVariablesResponseBody,
    ISourceResponseBody, IThreadsResponseBody, IEvaluateResponseBody, IDebugAdapter,
    ICompletionsResponseBody, IToggleSkipFileStatusArgs,
    ISetBreakpointResult, IRestartRequestArgs, IInitializeRequestArgs, ITelemetryPropertyCollector, IGetLoadedSourcesResponseBody, TimeTravelRuntime, IExceptionInfoResponseBody, ISetVariableResponseBody } from '../debugAdapterInterfaces';
import { IChromeDebugAdapterOpts, ChromeDebugSession } from './chromeDebugSession';
import { ChromeConnection } from './chromeConnection';
import * as ChromeUtils from './chromeUtils';
import { Protocol as Crdp } from 'devtools-protocol';
import { ScopeContainer, isIndexedPropName } from './variables';
import * as variables from './variables';
import { formatConsoleArguments, formatExceptionDetails, clearConsoleCode } from './consoleHelper';
import { StoppedEvent2, ReasonType } from './stoppedEvent';
import { stackTraceWithoutLogpointFrame } from './internalSourceBreakpoint';

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
import { mapRemoteClientToInternalPath, mapInternalSourceToRemoteClient } from '../remoteMapper';
import { Breakpoints } from './breakpoints';
import { VariablesManager } from './variablesManager';
import { StackFrames } from './stackFrames';
import { ScriptContainer } from './scripts';
import { SmartStepper } from './smartStep';
import { ScriptSkipper } from './scriptSkipping';
let localize = nls.loadMessageBundle();

export interface IPendingBreakpoint {
    args: ISetBreakpointsArgs;
    ids: number[];
    requestSeq: number;
    setWithPath: string;
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

export interface Transformers {
    lineColTransformer: LineColTransformer;
    sourceMapTransformer: BaseSourceMapTransformer;
    pathTransformer: BasePathTransformer;
}

export abstract class ChromeDebugAdapter implements IDebugAdapter {
    public static EVAL_NAME_PREFIX = ChromeUtils.EVAL_NAME_PREFIX;
    public static EVAL_ROOT = '<eval>';

    /**
     * Names of variables and properties to be filtered out of the results
     * from the adapter.
     */
    private static FILTERED_VARIABLE_NAMES = ['[[StableObjectId]]'];
    private static SCRIPTS_COMMAND = '.scripts';
    private static THREAD_ID = 1;
    private static ASYNC_CALL_STACK_DEPTH = 4;

    protected _session: ChromeDebugSession;
    protected _domains = new Map<CrdpDomain, Crdp.Schema.Domain>();
    private _clientAttached: boolean;
    private _currentPauseNotification: Crdp.Debugger.PausedEvent;
    private _exception: Crdp.Runtime.RemoteObject;
    private _expectingResumedEvent: boolean;
    protected _expectingStopReason: ReasonType;
    private _waitAfterStep = Promise.resolve();

    protected _chromeConnection: ChromeConnection;

    protected _clientRequestedSessionEnd: boolean;
    protected _hasTerminated: boolean;
    protected _inShutdown: boolean;
    protected _attachMode: boolean;
    protected _launchAttachArgs: ICommonRequestArgs;
    protected _port: number;

    private _currentStep = Promise.resolve();
    private _currentLogMessage = Promise.resolve();
    private _pauseOnPromiseRejections = true;
    protected _promiseRejectExceptionFilterEnabled = false;

    private _columnBreakpointsEnabled: boolean;

    private _smartStepEnabled: boolean;
    private _smartStepCount = 0;
    private _earlyScripts: Crdp.Debugger.ScriptParsedEvent[] = [];

    private _initialSourceMapsP = Promise.resolve();
    private _lastPauseState: { expecting: ReasonType; event: Crdp.Debugger.PausedEvent };
    protected _breakOnLoadHelper: BreakOnLoadHelper | null;
    // Queue to synchronize new source loaded and source removed events so that 'remove' script events
    // won't be send before the corresponding 'new' event has been sent
    private _sourceLoadedQueue: Promise<void> = Promise.resolve(null);

    // Promises so ScriptPaused events can wait for ScriptParsed events to finish resolving breakpoints
    private _scriptIdToBreakpointsAreResolvedDefer = new Map<string, PromiseDefer<void>>();

    private _batchTelemetryReporter: BatchTelemetryReporter;

    public readonly events: StepProgressEventsEmitter;

    private _loadedSourcesByScriptId = new Map<Crdp.Runtime.ScriptId, CrdpScript>();

    protected _isVSClient: boolean;

    public get columnBreakpointsEnabled() { return this._columnBreakpointsEnabled; }
    public get breakOnLoadHelper() { return this._breakOnLoadHelper; }

    protected _scriptContainer: ScriptContainer;
    protected _breakpoints: Breakpoints;
    protected _variablesManager: VariablesManager;
    protected _stackFrames: StackFrames;
    protected _smartStepper: SmartStepper;
    protected _scriptSkipper: ScriptSkipper;

    private _transformers: Transformers;

    public constructor({ chromeConnection, lineColTransformer, sourceMapTransformer, pathTransformer, targetFilter, breakpoints, scriptContainer }: IChromeDebugAdapterOpts,
        session: ChromeDebugSession
    ) {
        telemetry.setupEventHandler(e => session.sendEvent(e));
        this._batchTelemetryReporter = new BatchTelemetryReporter(telemetry);
        this._session = session;
        this._chromeConnection = new (chromeConnection || ChromeConnection)(undefined, targetFilter);
        this.events = new StepProgressEventsEmitter(this._chromeConnection.events ? [this._chromeConnection.events] : []);

        this._scriptContainer = new (scriptContainer || ScriptContainer)();

        this._transformers = {
            lineColTransformer: new (lineColTransformer || LineColTransformer)(this._session),
            sourceMapTransformer: new (sourceMapTransformer || EagerSourceMapTransformer)(this._scriptContainer),
            pathTransformer: new (pathTransformer || RemotePathTransformer)()
        };

        this._breakpoints = new (breakpoints || Breakpoints)(this, this._chromeConnection);
        this._variablesManager = new VariablesManager(this._chromeConnection);
        this._stackFrames = new StackFrames();
        this._scriptSkipper = new ScriptSkipper(this._chromeConnection, this._transformers);

        this.clearTargetContext();
    }

    public get chrome(): Crdp.ProtocolApi {
        return this._chromeConnection.api;
    }

    /**
     * @deprecated
     */
    public get scriptsById(): Map<Crdp.Runtime.ScriptId, CrdpScript> {
        return this._scriptContainer.scriptsByIdMap;
    }

    public get committedBreakpointsByUrl(): Map<string, ISetBreakpointResult[]> {
        return this._breakpoints.committedBreakpointsByUrl;
    }

    public get pathTransformer(): BasePathTransformer { return this._transformers.pathTransformer; }
    public get sourceMapTransformer(): BaseSourceMapTransformer { return this._transformers.sourceMapTransformer; }
    public get lineColTransformer(): LineColTransformer { return this._transformers.lineColTransformer; }

    public get session() { return this._session; }

    private get originProvider() { return (url: string) => this.getReadonlyOrigin(url);  }

    /**
     * Called on 'clearEverything' or on a navigation/refresh
     */
    protected clearTargetContext(): void {
        this.sourceMapTransformer.clearTargetContext();

        this._scriptContainer.reset();

        if (this._breakpoints) {
            this._breakpoints.reset();
        }

        this.pathTransformer.clearTargetContext();
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
            this._transformers.pathTransformer = new FallbackToClientPathTransformer(this._session);
        }

        this._isVSClient = args.clientID === 'visualstudio';
        utils.setCaseSensitivePaths(!this._isVSClient);
        this.sourceMapTransformer.isVSClient = this._isVSClient;

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
            supportsLoadedSourcesRequest: true,
            supportsBreakpointLocationsRequest: true
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

        this.sourceMapTransformer.launch(args);
        await this.pathTransformer.launch(args);

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
        this.sourceMapTransformer.attach(args);
        await this.pathTransformer.attach(args);

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

        let logTimestamps = args.logTimestamps;

        // The debug configuration provider should have set logFilePath on the launch config. If not, default to 'true' to use the
        // "legacy" log file path from the CDA subclass
        const logFilePath = args.logFilePath || logToFile;
        logger.setup(logLevel, logFilePath, logTimestamps);

        this._launchAttachArgs = args;

        // Enable sourcemaps and async callstacks by default
        args.sourceMaps = typeof args.sourceMaps === 'undefined' || args.sourceMaps;
        args.showAsyncStacks = typeof args.showAsyncStacks === 'undefined' || args.showAsyncStacks;

        this._smartStepper = new SmartStepper(this._launchAttachArgs.smartStep);

        if (args.breakOnLoadStrategy && args.breakOnLoadStrategy !== 'off') {
            this._breakOnLoadHelper = new BreakOnLoadHelper(this, args.breakOnLoadStrategy);
        }

        // Use hasOwnProperty to explicitly permit setting a falsy targetFilter.
        if (args.hasOwnProperty('targetFilter')) {
            this._chromeConnection.setTargetFilter(args.targetFilter);
        }
    }

    public shutdown(): void {
        this._batchTelemetryReporter.finalize();
        this._inShutdown = true;
        this._session.shutdown();
    }

    protected async terminateSession(reason: string, _disconnectArgs?: DebugProtocol.DisconnectArguments, restart?: IRestartRequestArgs): Promise<void> {
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

        this.chrome.Console.on('messageAdded', params => this.onMessageAdded(params));
        this.chrome.Runtime.on('consoleAPICalled', params => this.onConsoleAPICalled(params));
        this.chrome.Runtime.on('exceptionThrown', params => this.onExceptionThrown(params));
        this.chrome.Runtime.on('executionContextsCleared', () => this.onExecutionContextsCleared());
        this.chrome.Log.on('entryAdded', params => this.onLogEntryAdded(params));

        this.chrome.Debugger.on('breakpointResolved', params => this._breakpoints.onBreakpointResolved(params, this._scriptContainer));

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
                .catch(() => { /* Specifically ignore a fail here since it's only for backcompat */ }),
            utils.toVoidP(this.chrome.Debugger.enable()),
            this.chrome.Runtime.enable(),
            this.chrome.Log.enable()
                .catch(() => { }), // Not supported by all runtimes
            this._chromeConnection.run(),
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

            /* __GDPR__FRAGMENT__
               "StepNames" : {
                  "Attach.ConfigureDebuggingSession.Target" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
               }
             */
            this.events.emitStepStarted('Attach.ConfigureDebuggingSession.Target');

            // Make sure debugging domain is enabled before initializing the script skipper
            await Promise.all(this.runConnection());

            this._scriptSkipper.init(this._launchAttachArgs.skipFiles, this._launchAttachArgs.skipFileRegExps);

            await this.initSupportedDomains();
            const maxDepth = this._launchAttachArgs.showAsyncStacks ? ChromeDebugAdapter.ASYNC_CALL_STACK_DEPTH : 0;
            try {
                await this.chrome.Debugger.setAsyncCallStackDepth({ maxDepth });
            } catch (e) {
                // Not supported by older runtimes, ignore it.
            }

            if (this._breakOnLoadHelper) {
                this._breakOnLoadHelper.setBrowserVersion((await this._chromeConnection.version).browser);
            }

            /* __GDPR__FRAGMENT__
               "StepNames" : {
                  "Attach.ConfigureDebuggingSession.End" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
               }
             */
            this.events.emitStepStarted('Attach.ConfigureDebuggingSession.End');
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
        const cachedScriptParsedEvents = Array.from(this._scriptContainer.loadedScripts);
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

        this._variablesManager.onPaused();
        this._stackFrames.reset();
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
                    .catch(() => { /* ignore failures */ });
                return { didPause: false };
            }

            this._exception = notification.data;
        } else if (notification.hitBreakpoints && notification.hitBreakpoints.length) {
            reason = 'breakpoint';

            const result = this._breakpoints.handleHitCountBreakpoints(expectingStopReason, notification.hitBreakpoints);
            if (result) {
                return result;
            }

        } else if (expectingStopReason) {
            // If this was a step, check whether to smart step
            reason = expectingStopReason;
            shouldSmartStep = await this._shouldSmartStepCallFrame(this._currentPauseNotification.callFrames[0]);
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
                    stackTrace: this._exception.description && await this._stackFrames.mapFormattedException(this._exception.description, this._transformers),
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

        this.lineColTransformer.columnBreakpointsEnabled = this._columnBreakpointsEnabled;
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
                    if (!script.url.includes('internal/per_context')) {
                        await this.detectColumnBreakpointSupport(script.scriptId);
                        await this.sendInitializedEvent();
                    }
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

            this._scriptContainer.add(script);

            const mappedUrl = await this.pathTransformer.scriptParsed(script.url);

            const sourceMapsP = this.sourceMapTransformer.scriptParsed(mappedUrl, script.url, script.sourceMapURL).then(async sources => {
                if (this._hasTerminated) {
                    return undefined;
                }

                await this._breakpoints.handleScriptParsed(script, this._scriptContainer, mappedUrl, sources);
                await this._scriptSkipper.resolveSkipFiles(script, mappedUrl, sources);
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
        const origin = this.getReadonlyOrigin(script.url);
        const source = await this._scriptContainer.scriptToSource(script, origin);

        // This is a workaround for an edge bug, see https://github.com/Microsoft/vscode-chrome-debug-core/pull/329
        switch (loadedSourceEventReason) {
            case 'new':
            case 'changed':
                if (this._loadedSourcesByScriptId.get(script.scriptId)) {
                    if (source.sourceReference) {
                        // We only need to send changed events for dynamic scripts. The client tracks files on storage on it's own, so this notification is not needed
                        loadedSourceEventReason = 'changed';
                    } else {
                        return; // VS is strict about the changed notifications, and it will fail if we send a changed notification for a file on storage, so we omit it on purpose
                    }
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
            args.path = mapRemoteClientToInternalPath(args.path);
        }

        if (!await this.isInCurrentStack(args)) {
            // Only valid for files that are in the current stack
            const logName = args.path || this._scriptContainer.displayNameForSourceReference(args.sourceReference);
            logger.log(`Can't toggle the skipFile status for ${logName} - it's not in the current stack.`);
            return;
        } else {
            this._scriptSkipper.toggleSkipFileStatus(args, this._scriptContainer, this._transformers);
            this.onPaused(this._lastPauseState.event, this._lastPauseState.expecting);
        }
    }

    private async isInCurrentStack(args: IToggleSkipFileStatusArgs): Promise<boolean> {
        const currentStack = await this.stackTrace({ threadId: undefined });

        if (args.path) {
            return currentStack.stackFrames.some(frame => frame.source && frame.source.path === args.path);
        } else {
            return currentStack.stackFrames.some(frame => frame.source && frame.source.sourceReference === args.sourceReference);
        }
    }

    /* __GDPR__
        "ClientRequest/loadedSources" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async loadedSources(): Promise<IGetLoadedSourcesResponseBody> {
        const sources = await Promise.all(Array.from(this._scriptContainer.loadedScripts)
            .map(script => this._scriptContainer.scriptToSource(script, this.getReadonlyOrigin(script.url))));

        return { sources: sources.sort((a, b) => a.path.localeCompare(b.path)) };
    }

    protected onConsoleAPICalled(event: Crdp.Runtime.ConsoleAPICalledEvent): void {
        if (this._launchAttachArgs._suppressConsoleOutput) {
            return;
        }

        const result = formatConsoleArguments(event.type, event.args, event.stackTrace);
        const stack = stackTraceWithoutLogpointFrame(event.stackTrace);
        if (result) {
            this.logObjects(result.args, result.isError, stack);
        }
    }

    private onLogEntryAdded(event: Crdp.Log.EntryAddedEvent): void {
        // The Debug Console doesn't give the user a way to filter by level, just ignore 'verbose' logs
        if (event.entry.level === 'verbose') {
            return;
        }

        const args = event.entry.args || [];

        let text = event.entry.text || '';
        if (event.entry.url && !event.entry.stackTrace) {
            if (text) {
                text += ' ';
            }

            text += `[${event.entry.url}]`;
        }

        if (text) {
            args.unshift({
                type: 'string',
                value: text
            });
        }

        const type = event.entry.level === 'error' ? 'error' :
            event.entry.level === 'warning' ? 'warning' :
            'log';
        const result = formatConsoleArguments(type, args, event.entry.stackTrace);
        const stack = event.entry.stackTrace;
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
                    let msg: string = objs[0].value;
                    if (isError) {
                        msg = await this._stackFrames.mapFormattedException(msg, this._transformers);
                    }

                    if (!msg.endsWith(clearConsoleCode)) {
                        // If this string will clear the console, don't append a \n
                        msg += '\n';
                    }

                    e = new OutputEvent(msg, category);
                } else {
                    e = new OutputEvent('output', category);
                    e.body.variablesReference = this._variablesManager.createHandle(new variables.LoggedObjects(objs), 'repl');
                }

                if (stackTrace && stackTrace.callFrames.length) {
                    const stackFrame = await this._stackFrames.mapCallFrame(stackTrace.callFrames[0], this._transformers, this._scriptContainer, this.originProvider);
                    e.body.source = mapInternalSourceToRemoteClient(stackFrame.source, this._launchAttachArgs.remoteAuthority);
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
            const exceptionStr = await this._stackFrames.mapFormattedException(formattedException, this._transformers);

            const e: DebugProtocol.OutputEvent = new OutputEvent(exceptionStr + '\n', 'stderr');
            const stackTrace = params.exceptionDetails.stackTrace;
            if (stackTrace && stackTrace.callFrames.length) {
                const stackFrame = await this._stackFrames.mapCallFrame(stackTrace.callFrames[0], this._transformers, this._scriptContainer, this.originProvider);
                e.body.source = mapInternalSourceToRemoteClient(stackFrame.source, this._launchAttachArgs.remoteAuthority);
                e.body.line = stackFrame.line;
                e.body.column = stackFrame.column;
            }

            this._session.sendEvent(e);
        })
        .catch(err => logger.error(err.toString()));
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
        this._clientRequestedSessionEnd = true;
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
        if (args.source.path) {
            args.source.path = mapRemoteClientToInternalPath(args.source.path);
        }
        this.reportBpTelemetry(args);
        return this._breakpoints.setBreakpoints(args, this._scriptContainer, requestSeq, ids);
    }

    private reportBpTelemetry(args: ISetBreakpointsArgs): void {
        let fileExt = '';
        if (args.source.path) {
            fileExt = path.extname(args.source.path);
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
                () => { /* ignore failures - client can send the request when the target is no longer paused */ });
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
                () => { /* ignore failures - client can send the request when the target is no longer paused */ });
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
                () => { /* ignore failures - client can send the request when the target is no longer paused */ });
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
                () => { /* ignore failures - client can send the request when the target is no longer paused */ });
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
                () => { /* ignore failures - client can send the request when the target is no longer paused */ });
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
                () => { /* ignore failures - client can send the request when the target is no longer paused */ });
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

        const stackTraceResponse = await this._stackFrames.getStackTrace({
            args,
            originProvider: this.originProvider,
            scripts: this._scriptContainer,
            scriptSkipper: this._scriptSkipper,
            smartStepper: this._smartStepper,
            transformers: this._transformers,
            pauseEvent: this._currentPauseNotification });

        stackTraceResponse.stackFrames = stackTraceResponse.stackFrames.map(frame => {
            return { ...frame, source: mapInternalSourceToRemoteClient(frame.source, this._launchAttachArgs.remoteAuthority) };
        });

        return stackTraceResponse;
    }

    /**
     * A stub method for overriding (used for the node debug adapter)
     */
    protected getReadonlyOrigin(_url: string): string {
        // To override
        return undefined;
    }

    public realPathToDisplayPath(realPath: string): string { return this._scriptContainer.realPathToDisplayPath(realPath); }
    public displayPathToRealPath(displayPath: string): string { return this._scriptContainer.displayPathToRealPath(displayPath); }

    /* __GDPR__
        "ClientRequest/scopes" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public scopes(args: DebugProtocol.ScopesArguments): IScopesResponseBody {
        return this._stackFrames.getScopes({
            args,
            scripts: this._scriptContainer,
            variables: this._variablesManager,
            transformers: this._transformers,
            pauseEvent: this._currentPauseNotification,
            currentException: this._exception
        });
    }

    /* __GDPR__
        "ClientRequest/variables" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async variables(args: DebugProtocol.VariablesArguments): Promise<IVariablesResponseBody> {
        const result = await this._variablesManager.getVariables(args);
        const variables = result ? result.variables : [];
        return { variables: variables.filter(v => ChromeDebugAdapter.FILTERED_VARIABLE_NAMES.indexOf(v.name) === -1) };
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
            const handle = this._scriptContainer.getSource(args.sourceReference);
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
        const variable = await this._variablesManager.remoteObjectToVariable(args.expression, evalResponse.result, /*parentEvaluateName=*/undefined, /*stringify=*/undefined, <VariableContext>args.context);
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
            outputStringP = this._scriptContainer.getAllScriptsString(this.pathTransformer, this.sourceMapTransformer);
        }

        return outputStringP.then(scriptsStr => {
            this._session.sendEvent(new OutputEvent(scriptsStr));
            return <IEvaluateResponseBody>{
                result: '',
                variablesReference: 0
            };
        });
    }

    private async _shouldSmartStepCallFrame(frame: Crdp.Debugger.CallFrame): Promise<boolean> {
        const stackFrame = this._stackFrames.callFrameToStackFrame(frame, this._scriptContainer, this.originProvider);
        const fakeResponse = { stackFrames: [stackFrame] };
        await this.pathTransformer.stackTraceResponse(fakeResponse);
        await this.sourceMapTransformer.stackTraceResponse(fakeResponse);
        return this._smartStepper.shouldSmartStep(fakeResponse.stackFrames[0], this.pathTransformer, this.sourceMapTransformer);
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
            const frame = this._stackFrames.getFrame(frameId);
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

    async evaluateOnCallFrame(expression: string, frame: Crdp.Debugger.CallFrame, extraArgs?: Partial<Crdp.Runtime.EvaluateRequest>): Promise<Crdp.Debugger.EvaluateOnCallFrameResponse | Crdp.Runtime.EvaluateResponse> {
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
        return this._variablesManager.setVariable(args);
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
        const callFrame = this._stackFrames.getFrame(args.frameId);
        if (!callFrame || !callFrame.callFrameId) {
            return utils.errP(errors.noRestartFrame);
        }

        try {
            await this.chrome.Debugger.restartFrame({ callFrameId: callFrame.callFrameId });
        } catch (_e) { } // Fails in Electron 6, ignore: https://github.com/microsoft/vscode/issues/86411

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
            if (!this._stackFrames.getFrame(args.frameId)) {
                return Promise.reject(errors.stackFrameNotValid());
            }

            const callFrame = this._stackFrames.getFrame(args.frameId);
            if (!callFrame || !callFrame.callFrameId) {
                // Async frame or label
                return { targets: [] };
            }

            const scopeExpandPs = callFrame.scopeChain
                .map(scope => new ScopeContainer(callFrame.callFrameId, undefined, scope.object.objectId).expand(this._variablesManager));
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

    private getScriptByUrl(url: string): Crdp.Debugger.ScriptParsedEvent {
        return this._scriptContainer.getScriptByUrl(url);
    }

    public breakpointLocations(args: DebugProtocol.BreakpointLocationsArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, requestSeq?: number): Promise<DebugProtocol.BreakpointLocationsResponse['body']> {
        return this._breakpoints.getBreakpointsLocations(args, this._scriptContainer, requestSeq);
    }
}
