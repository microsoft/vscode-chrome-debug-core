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

export interface IChromeDebugAdapterOpts {
    targetFilter?: ITargetFilter;
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
        super(undefined, obsolete_debuggerLinesAndColumnsStartAt1, obsolete_isServer);

        logVersionInfo();
        this._extensionName = opts.extensionName;
        this._debugAdapter = new (<any>opts.adapter)(opts, this);

        const safeGetErrDetails = err => {
            let errMsg;
            try {
                errMsg = (<Error>err).stack ? (<Error>err).stack : JSON.stringify(err);
            } catch (e) {
                errMsg = 'Error while handling previous error: ' + e.stack;
            }

            return errMsg;
        };

        process.on('uncaughtException', (err: any) => {
            logger.error(`******** Unhandled error in debug adapter: ${safeGetErrDetails(err)}`);
            throw err;
        });

        process.addListener('unhandledRejection', (err: Error|DebugProtocol.Message) => {
            // Node tests are watching for the ********, so fix the tests if it's changed
            logger.error(`******** Unhandled error in debug adapter - Unhandled promise rejection: ${safeGetErrDetails(err)}`);
        });
    }

    /**
     * Takes a response and a promise to the response body. If the promise is successful, assigns the response body and sends the response.
     * If the promise fails, sets the appropriate response parameters and sends the response.
     */
    private sendResponseAsync(request: DebugProtocol.Request, response: DebugProtocol.Response, responseP: Promise<any>): void {
        responseP.then(
            (body?) => {
                response.body = body;
                this.sendResponse(response);
            },
            e => this.failedRequest(request.command, response, e));
    }

    /**
     * Overload dispatchRequest to the debug adapters' Promise-based methods instead of DebugSession's callback-based methods
     */
    protected dispatchRequest(request: DebugProtocol.Request): void {
        const response = new Response(request);
        try {
            logger.verbose(`From client: ${request.command}(${JSON.stringify(request.arguments) })`);

            if (!(request.command in this._debugAdapter)) {
                this.sendUnknownCommandResponse(response, request.command);
                return;
            }

            const responseP = Promise.resolve(this._debugAdapter[request.command](request.arguments, request.seq));
            this.sendResponseAsync(
                request,
                response,
                responseP);
        } catch (e) {
            this.failedRequest(request.command, response, e);
        }
    }

    private failedRequest(requestType: string, response: DebugProtocol.Response, error: RequestHandleError): void {
        if (isMessage(error)) {
            this.sendErrorResponse(response, error as DebugProtocol.Message);
            return;
        }

        if (requestType === 'evaluate') {
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
}

function logVersionInfo(): void {
    const d = new Date();
    const timestamp = d.toLocaleTimeString() + ', ' + d.toLocaleDateString();
    logger.verbose(timestamp);

    logger.log(`OS: ${os.platform()} ${os.arch()}`);
    logger.log(`Adapter node: ${process.version} ${process.arch}`);
    logger.log('vscode-chrome-debug-core: ' + require('../../../package.json').version);
}
