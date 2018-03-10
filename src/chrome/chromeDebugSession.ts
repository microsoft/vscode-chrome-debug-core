/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as os from 'os';
import {DebugProtocol} from 'vscode-debugprotocol';
import {LoggingDebugSession, ErrorDestination, Response, logger} from 'vscode-debugadapter';

import {ChromeDebugAdapter} from './chromeDebugAdapter';
import {ITargetFilter, ChromeConnection, IChromeError} from './chromeConnection';
import {BasePathTransformer} from '../transformers/basePathTransformer';
import {BaseSourceMapTransformer} from '../transformers/baseSourceMapTransformer';
import {LineColTransformer} from '../transformers/lineNumberTransformer';

import {IDebugAdapter} from '../debugAdapterInterfaces';
import { telemetry, ExceptionType, IExecutionResultTelemetryProperties } from '../telemetry';
import * as utils from '../utils';
import { ExecutionTimingsReporter, StepProgressEventsEmitter, IObservableEvents, IStepStartedEventsEmitter, IFinishedStartingUpEventsEmitter} from '../executionTimingsReporter';

export interface IChromeDebugAdapterOpts {
    targetFilter?: ITargetFilter;
    logFilePath?: string; // obsolete, vscode log dir should be used
    enableSourceMapCaching?: boolean;

    // Override services
    chromeConnection?: typeof ChromeConnection;
    pathTransformer?: { new(): BasePathTransformer };
    sourceMapTransformer?: { new(sourceHandles: any, enableSourcemapCaching?: boolean): BaseSourceMapTransformer };
    lineColTransformer?: { new(session: any): LineColTransformer };
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
            telemetry.reportEvent(ErrorTelemetryEventName, properties);
        };

        process.on('uncaughtException', (err: any) => {
            logger.error(`******** Unhandled error in debug adapter: ${safeGetErrDetails(err)}`);

            reportErrorTelemetry(err, 'uncaughtException');
            throw err;
        });

        process.addListener('unhandledRejection', (err: Error|DebugProtocol.Message) => {
            // Node tests are watching for the ********, so fix the tests if it's changed
            logger.error(`******** Unhandled error in debug adapter - Unhandled promise rejection: ${safeGetErrDetails(err)}`);

            reportErrorTelemetry(err, 'unhandledRejection');
        });
    }

    /**
     * Overload dispatchRequest to the debug adapters' Promise-based methods instead of DebugSession's callback-based methods
     */
    protected dispatchRequest(request: DebugProtocol.Request): void {
        // We want the request to be non-blocking, so we won't await for reportTelemetry
        this.reportTelemetry(`clientRequest/${request.command}`, { requestType: request.type }, async (reportFailure) => {
            const response: DebugProtocol.Response = new Response(request);
            try {
                logger.verbose(`From client: ${request.command}(${JSON.stringify(request.arguments) })`);

                if (!(request.command in this._debugAdapter)) {
                    reportFailure('The debug adapter doesn\'t recognize this command');
                    this.sendUnknownCommandResponse(response, request.command);
                } else {
                    response.body = await this._debugAdapter[request.command](request.arguments, request.seq);
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
    private async reportTelemetry(eventName: string, propertiesSpecificToAction: {[property: string]: string}, action: (reportFailure: (failure: any) => void) => Promise<void>): Promise<void> {
        const startProcessingTime = process.hrtime();
        const startTime = Date.now();
        const isSequentialRequest = eventName === "clientRequest/initialize" || eventName === "clientRequest/launch" || eventName === "clientRequest/attach";
        const properties: IExecutionResultTelemetryProperties = propertiesSpecificToAction;
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
        await action(reportFailure);
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

        const errMsg = isChromeError(error) ?
            error.message + ': ' + error.data :
            (error.stack || error.message);

        logger.error(`Error processing "${requestType}": ${errMsg}`);

        // These errors show up in the message bar at the top (or nowhere), sometimes not obvious that they
        // come from the adapter, so add extensionName
        this.sendErrorResponse(
            response,
            1104,
            '[{_extensionName}] Error processing "{_requestType}": {_stack}',
            { _extensionName: this._extensionName, _requestType: requestType, _stack: errMsg },
            ErrorDestination.Telemetry);
    }

    private sendUnknownCommandResponse(response: DebugProtocol.Response, command: string): void {
        this.sendErrorResponse(response, 1014, `[${this._extensionName}] Unrecognized request: ${command}`, null, ErrorDestination.Telemetry);
    }

    public reportTimingsWhileStartingUpIfNeeded(requestedContentWasDetected: boolean | "timeout"): void {
        if (!this.haveTimingsWhileStartingUpBeenReported) {
            const report = this.reporter.generateReport();
            const telemetryData = { requestedContentWasDetected: requestedContentWasDetected.toString() };
            for (const reportProperty in report) {
                telemetryData[reportProperty] = JSON.stringify(report[reportProperty]);
            }

            telemetry.reportEvent('report-start-up-timings', telemetryData);
            this.haveTimingsWhileStartingUpBeenReported = true;
        }
    }

    private configureExecutionTimingsReporting(): void {
        this.reporter.subscribeTo(this.events);
        this._debugAdapter.events.once(ChromeDebugSession.FinishedStartingUpEventName, () => {
            this.reportTimingsWhileStartingUpIfNeeded(true);
        });

        setTimeout(() => this.reportTimingsWhileStartingUpIfNeeded("timeout"), this._readyForUserTimeoutInMilliseconds);
    }

    public shutdown(): void {
        this.reportTimingsWhileStartingUpIfNeeded(/*requestedContentWasDetected*/false);
        super.shutdown();
    }
}

function logVersionInfo(): void {
    logger.log(`OS: ${os.platform()} ${os.arch()}`);
    logger.log(`Adapter node: ${process.version} ${process.arch}`);
    logger.log('vscode-chrome-debug-core: ' + require('../../../package.json').version);
}
