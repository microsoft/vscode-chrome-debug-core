/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as os from 'os';
import { DebugProtocol } from 'vscode-debugprotocol';
import { LoggingDebugSession, ErrorDestination, Response, logger } from 'vscode-debugadapter';

import { ChromeDebugAdapter } from './chromeDebugAdapter';
import { ITargetFilter, ChromeConnection, IChromeError } from './chromeConnection';
import { BasePathTransformer } from '../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../transformers/baseSourceMapTransformer';
import { LineColTransformer } from '../transformers/lineNumberTransformer';

import { IDebugAdapter } from '../debugAdapterInterfaces';
import { telemetry, ExceptionType, IExecutionResultTelemetryProperties, TelemetryPropertyCollector, ITelemetryPropertyCollector } from '../telemetry';
import * as utils from '../utils';
import { ExecutionTimingsReporter, StepProgressEventsEmitter, IObservableEvents, IStepStartedEventsEmitter, IFinishedStartingUpEventsEmitter } from '../executionTimingsReporter';
import { Breakpoints } from './breakpoints';
import { ScriptContainer } from '../chrome/scripts';

export interface IChromeDebugAdapterOpts {
    targetFilter?: ITargetFilter;
    logFilePath?: string; // obsolete, vscode log dir should be used

    // Override services
    chromeConnection?: typeof ChromeConnection;
    pathTransformer?: { new(): BasePathTransformer };
    sourceMapTransformer?: { new(sourceHandles: any): BaseSourceMapTransformer };
    lineColTransformer?: { new(session: any): LineColTransformer };

    breakpoints?: typeof Breakpoints;
    scriptContainer?: typeof ScriptContainer;
}

export interface IChromeDebugSessionOpts extends IChromeDebugAdapterOpts {
    /** The class of the adapter, which is instantiated for each session */
    adapter: typeof ChromeDebugAdapter;
    extensionName: string;
}

export const ErrorTelemetryEventName = 'error';

// A failed request can return either an Error, an error from Chrome, or a DebugProtocol.Message which is returned as-is to the client
type RequestHandleError = Error | DebugProtocol.Message | IChromeError;

function isMessage(e: RequestHandleError): e is DebugProtocol.Message {
    return !!(<DebugProtocol.Message>e).format;
}

function isChromeError(e: RequestHandleError): e is IChromeError {
    return !!(<IChromeError>e).data;
}

export class ChromeDebugSession extends LoggingDebugSession implements IObservableEvents<IStepStartedEventsEmitter & IFinishedStartingUpEventsEmitter> {
    private readonly _readyForUserTimeoutInMilliseconds = 5 * 60 * 1000; // 5 Minutes = 5 * 60 seconds = 5 * 60 * 1000 milliseconds

    private _debugAdapter: IDebugAdapter & IObservableEvents<IStepStartedEventsEmitter & IFinishedStartingUpEventsEmitter>;
    private _extensionName: string;
    public readonly events: StepProgressEventsEmitter;
    private reporter = new ExecutionTimingsReporter();
    private haveTimingsWhileStartingUpBeenReported = false;

    public static readonly FinishedStartingUpEventName = 'finishedStartingUp';

    /**
     * This needs a bit of explanation -
     * The Session is reinstantiated for each session, but consumers need to configure their instance of
     * ChromeDebugSession. Consumers should call getSession with their config options, then call
     * DebugSession.run with the result. Alternatively they could subclass ChromeDebugSession and pass
     * their options to the super constructor, but I think this is easier to follow.
     */
    public static getSession(opts: IChromeDebugSessionOpts): typeof ChromeDebugSession {
        // class expression!
        return class extends ChromeDebugSession {
            constructor(debuggerLinesAndColumnsStartAt1?: boolean, isServer?: boolean) {
                super(debuggerLinesAndColumnsStartAt1, isServer, opts);
            }
        };
    }

    public constructor(obsolete_debuggerLinesAndColumnsStartAt1?: boolean, obsolete_isServer?: boolean, opts?: IChromeDebugSessionOpts) {
        super(opts.logFilePath, obsolete_debuggerLinesAndColumnsStartAt1, obsolete_isServer);

        logVersionInfo();
        this._extensionName = opts.extensionName;
        this._debugAdapter = new (<any>opts.adapter)(opts, this);
        this.events = new StepProgressEventsEmitter([this._debugAdapter.events]);
        this.configureExecutionTimingsReporting();

        const safeGetErrDetails = err => {
            let errMsg;
            try {
                errMsg = (err && (<Error>err).stack) ? (<Error>err).stack : JSON.stringify(err);
            } catch (e) {
                errMsg = 'Error while handling previous error: ' + e.stack;
            }

            return errMsg;
        };

        const reportErrorTelemetry = (err, exceptionType: ExceptionType)  => {
            let properties: IExecutionResultTelemetryProperties = {};
            properties.successful = 'false';
            properties.exceptionType = exceptionType;

            utils.fillErrorDetails(properties, err);

            /* __GDPR__
               "error" : {
                    "${include}": [
                        "${IExecutionResultTelemetryProperties}",
                        "${DebugCommonProperties}"
                    ]
               }
             */
            telemetry.reportEvent(ErrorTelemetryEventName, properties);
        };

        process.addListener('uncaughtException', (err: any) => {
            reportErrorTelemetry(err, 'uncaughtException');

            logger.error(`******** Unhandled error in debug adapter: ${safeGetErrDetails(err)}`);
        });

        process.addListener('unhandledRejection', (err: Error|DebugProtocol.Message) => {
            reportErrorTelemetry(err, 'unhandledRejection');

            // Node tests are watching for the ********, so fix the tests if it's changed
            logger.error(`******** Unhandled error in debug adapter - Unhandled promise rejection: ${safeGetErrDetails(err)}`);
        });
    }

    /**
     * Overload dispatchRequest to the debug adapters' Promise-based methods instead of DebugSession's callback-based methods
     */
    protected dispatchRequest(request: DebugProtocol.Request): void {
        // We want the request to be non-blocking, so we won't await for reportTelemetry
        this.reportTelemetry(`ClientRequest/${request.command}`, async (reportFailure, telemetryPropertyCollector) => {
            const response: DebugProtocol.Response = new Response(request);
            try {
                logger.verbose(`From client: ${request.command}(${JSON.stringify(request.arguments) })`);

                if (!(request.command in this._debugAdapter)) {
                    reportFailure('The debug adapter doesn\'t recognize this command');
                    this.sendUnknownCommandResponse(response, request.command);
                } else {
                    telemetryPropertyCollector.addTelemetryProperty('requestType', request.type);
                    response.body = await this._debugAdapter[request.command](request.arguments, telemetryPropertyCollector, request.seq);
                    this.sendResponse(response);
                }
            } catch (e) {
                if (!this.isEvaluateRequest(request.command, e)) {
                    reportFailure(e);
                }
                this.failedRequest(request.command, response, e);
            }
        });
    }

    // { command: request.command, type: request.type };
    private async reportTelemetry(eventName: string,
                                  action: (reportFailure: (failure: any) => void, telemetryPropertyCollector: ITelemetryPropertyCollector) => Promise<void>): Promise<void> {
        const startProcessingTime = process.hrtime();
        const startTime = Date.now();
        const isSequentialRequest = eventName === 'ClientRequest/initialize' || eventName === 'ClientRequest/launch' || eventName === 'ClientRequest/attach';
        const properties: IExecutionResultTelemetryProperties = {};
        const telemetryPropertyCollector = new TelemetryPropertyCollector();

        if (isSequentialRequest) {
            this.events.emitStepStarted(eventName);
        }

        let failed = false;

        const sendTelemetry = () => {
            const timeTakenInMilliseconds = utils.calculateElapsedTime(startProcessingTime);
            properties.timeTakenInMilliseconds = timeTakenInMilliseconds.toString();
            if (isSequentialRequest) {
                this.events.emitStepCompleted(eventName);
            } else {
                this.events.emitRequestCompleted(eventName, startTime, timeTakenInMilliseconds);
            }
            Object.assign(properties, telemetryPropertyCollector.getProperties());

            // GDPR annotations go with each individual request type
            telemetry.reportEvent(eventName, properties);
        };

        const reportFailure = e => {
            failed = true;
            properties.successful = 'false';
            properties.exceptionType = 'firstChance';
            utils.fillErrorDetails(properties, e);

            sendTelemetry();
        };

        // We use the reportFailure callback because the client might exit immediately after the first failed request, so we need to send the telemetry before that, if not it might get dropped
        await action(reportFailure, telemetryPropertyCollector);
        if (!failed) {
            properties.successful = 'true';
            sendTelemetry();
        }
    }

    private isEvaluateRequest(requestType: string, error: RequestHandleError): boolean {
        return !isMessage(error) && (requestType === 'evaluate');
    }

    private failedRequest(requestType: string, response: DebugProtocol.Response, error: RequestHandleError): void {
        if (isMessage(error)) {
            this.sendErrorResponse(response, error as DebugProtocol.Message);
            return;
        }

        if (this.isEvaluateRequest(requestType, error)) {
            // Errors from evaluate show up in the console or watches pane. Doesn't seem right
            // as it's not really a failed request. So it doesn't need the [extensionName] tag and worth special casing.
            response.message = error ? error.message : 'Unknown error';
            response.success = false;
            this.sendResponse(response);
            return;
        }

        const errUserMsg = isChromeError(error) ?
            error.message + ': ' + error.data :
            (error.message || error.stack);

        const errDiagnosticMsg = isChromeError(error) ?
            errUserMsg : (error.stack || error.message);

        logger.error(`Error processing "${requestType}": ${errDiagnosticMsg}`);

        // These errors show up in the message bar at the top (or nowhere), sometimes not obvious that they
        // come from the adapter, so add extensionName
        this.sendErrorResponse(
            response,
            1104,
            '[{_extensionName}] Error processing "{_requestType}": {_stack}',
            { _extensionName: this._extensionName, _requestType: requestType, _stack: errUserMsg },
            ErrorDestination.Telemetry);
    }

    private sendUnknownCommandResponse(response: DebugProtocol.Response, command: string): void {
        this.sendErrorResponse(response, 1014, `[${this._extensionName}] Unrecognized request: ${command}`, null, ErrorDestination.Telemetry);
    }

    public reportTimingsWhileStartingUpIfNeeded(requestedContentWasDetected: boolean, reasonForNotDetected?: string): void {
        if (!this.haveTimingsWhileStartingUpBeenReported) {
            const report = this.reporter.generateReport();
            const telemetryData = { RequestedContentWasDetected: requestedContentWasDetected.toString() } as {[key: string]: string};
            for (const reportProperty in report) {
                telemetryData[reportProperty] = JSON.stringify(report[reportProperty]);
            }

            if (!requestedContentWasDetected && typeof reasonForNotDetected !== 'undefined') {
                telemetryData.RequestedContentWasNotDetectedReason = reasonForNotDetected;
            }

            /* __GDPR__
               "report-start-up-timings" : {
                  "RequestedContentWasNotDetectedReason" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
                  "${include}": [
                      "${ReportProps}",
                      "${DebugCommonProperties}"
                    ]
               }
             */
            telemetry.reportEvent('report-start-up-timings', telemetryData);
            this.haveTimingsWhileStartingUpBeenReported = true;
        }
    }

    private configureExecutionTimingsReporting(): void {
        this.reporter.subscribeTo(this.events);
        this._debugAdapter.events.once(ChromeDebugSession.FinishedStartingUpEventName, args => {
            this.reportTimingsWhileStartingUpIfNeeded(args ? args.requestedContentWasDetected : true, args && args.reasonForNotDetected);
        });

        setTimeout(() => this.reportTimingsWhileStartingUpIfNeeded(/*requestedContentWasDetected*/false, /*reasonForNotDetected*/'timeout'), this._readyForUserTimeoutInMilliseconds);
    }

    public shutdown(): void {
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');

        this.reportTimingsWhileStartingUpIfNeeded(/*requestedContentWasDetected*/false, /*reasonForNotDetected*/'shutdown');
        super.shutdown();
    }

    public sendResponse(response: DebugProtocol.Response): void {
        const originalLogVerbose = logger.verbose;
        try {
            logger.verbose = textToLog => {
                if (response && response.command === 'source' && response.body && response.body.content) {
                    const clonedResponse = Object.assign({}, response);
                    clonedResponse.body = Object.assign({}, response.body);
                    clonedResponse.body.content = '<removed script source for logs>';
                    return originalLogVerbose.call(logger, `To client: ${JSON.stringify(clonedResponse)}`);
                } else {
                    return originalLogVerbose.call(logger, textToLog);
                }
            };
            super.sendResponse(response);
        } finally {
            logger.verbose = originalLogVerbose;
        }
    }

}

function logVersionInfo(): void {
    logger.log(`OS: ${os.platform()} ${os.arch()}`);
    logger.log(`Adapter node: ${process.version} ${process.arch}`);
    const coreVersion = require('../../../package.json').version;
    logger.log('vscode-chrome-debug-core: ' + coreVersion);

    /* __GDPR__FRAGMENT__
       "DebugCommonProperties" : {
          "Versions.DebugAdapterCore" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
       }
     */
    telemetry.addCustomGlobalProperty( { 'Versions.DebugAdapterCore': coreVersion });
}
