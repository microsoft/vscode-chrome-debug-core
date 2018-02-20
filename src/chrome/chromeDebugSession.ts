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
import { telemetry } from '../telemetry';

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

export type ExceptionType = "uncaughtException" | "unhandledRejection" | "generic";

export interface  IExceptionTelemetryProperties {
    // There is an issue on some clients and reportEvent only currently accept strings properties,
    // hence all the following properties must be strings.
    successful?: "true" | "false";
    exceptionType?: ExceptionType;
    exceptionMessage?: string;
    exceptionName?: string;
    exceptionStack?: string;
    timeTakenInMilliseconds?: string;
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

export class ChromeDebugSession extends LoggingDebugSession {
    private _debugAdapter: IDebugAdapter;
    private _extensionName: string;

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
            let properties: IExceptionTelemetryProperties = {};
            properties.successful = "false";
            properties.exceptionType = exceptionType;
            properties.timeTakenInMilliseconds = "";

            this.fillErrorDetails(properties, err);
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
                    reportFailure("The debug adapter doesn't recognize this command");
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
        const properties: IExceptionTelemetryProperties = propertiesSpecificToAction;

        let failed = false;

        const sendTelemetry = () => {
            const NanoSecondsPerMillisecond = 1000000;
            const MillisecondsPerSecond = 1000;

            const ellapsedTime = process.hrtime(startProcessingTime);
            const ellapsedMilliseconds = ellapsedTime[0] * MillisecondsPerSecond + ellapsedTime[1] / NanoSecondsPerMillisecond;
            properties.timeTakenInMilliseconds = ellapsedMilliseconds.toString();

            telemetry.reportEvent(eventName, properties);
        };

        const reportFailure = e => {
            failed = true;
            properties.successful = "false";
            properties.exceptionType = "generic";
            this.fillErrorDetails(properties, e);

            sendTelemetry();
        };

        // We use the reportFailure callback because the client might exit immediately after the first failed request, so we need to send the telemetry before that, if not it might get dropped
        await action(reportFailure);
        if (!failed) {
            properties.successful = "true";
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

    private fillErrorDetails(properties: IExceptionTelemetryProperties, e: any): void {
        properties.exceptionMessage = e.message || e.toString();
        if (e.name) {
            properties.exceptionName = e.name;
        }
        if (e.stack) {
            properties.exceptionStack = e.stack;
        }
    }
}

function logVersionInfo(): void {
    logger.log(`OS: ${os.platform()} ${os.arch()}`);
    logger.log(`Adapter node: ${process.version} ${process.arch}`);
    logger.log('vscode-chrome-debug-core: ' + require('../../../package.json').version);
}
