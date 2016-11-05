/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as os from 'os';
import {DebugProtocol} from 'vscode-debugprotocol';
import {DebugSession, ErrorDestination, OutputEvent, Response} from 'vscode-debugadapter';

import {ChromeDebugAdapter} from './chromeDebugAdapter';
import {ITargetFilter, ChromeConnection} from './chromeConnection';
import {BasePathTransformer} from '../transformers/basePathTransformer';
import {BaseSourceMapTransformer} from '../transformers/baseSourceMapTransformer';
import {LineColTransformer} from '../transformers/lineNumberTransformer';

import {IDebugAdapter} from '../debugAdapterInterfaces';
import * as utils from '../utils';
import * as logger from '../logger';

export interface IChromeDebugAdapterOpts {
    targetFilter?: ITargetFilter;
    logFilePath?: string;

    // Override services
    chromeConnection?: typeof ChromeConnection;
    pathTransformer?: typeof BasePathTransformer;
    sourceMapTransformer?: typeof BaseSourceMapTransformer;
    lineColTransformer?: typeof LineColTransformer;
}

export interface IChromeDebugSessionOpts extends IChromeDebugAdapterOpts {
    /** The class of the adapter, which is instantiated for each session */
    adapter: typeof ChromeDebugAdapter;
    extensionName: string;
}

export class ChromeDebugSession extends DebugSession {
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

    public constructor(debuggerLinesAndColumnsStartAt1?: boolean, isServer?: boolean, opts?: IChromeDebugSessionOpts) {
        super();

        this._extensionName = opts.extensionName;
        this._debugAdapter = new (<any>opts.adapter)(opts, this);

        const logFilePath =  opts.logFilePath;
        logger.init((msg, level) => this.onLog(msg, level), logFilePath, isServer);
        logVersionInfo();

        const safeGetErrDetails = err => {
            let errMsg;
            try {
                errMsg = (<Error>err).stack ? (<Error>err).stack : JSON.stringify(err);
            } catch (e) {
                errMsg = 'Error while handling previous error: ' + e.stack;
            }

            return errMsg;
        };

        process.on('uncaughtException', function(err) {
            logger.error(`******** Unhandled error in debug adapter: ${safeGetErrDetails(err)}`);
            throw err;
        });

        process.addListener('unhandledRejection', (err: Error|DebugProtocol.Message) => {
            // Node tests are watching for the ********, so fix the tests if it's changed
            logger.error(`******** Unhandled error in debug adapter - Unhandled promise rejection: ${safeGetErrDetails(err)}`);
        });
    }

    /**
     * Overload sendEvent to log
     */
    public sendEvent(event: DebugProtocol.Event): void {
        if (event.event !== 'output') {
            // Don't create an infinite loop...
            logger.verbose(`To client: ${JSON.stringify(event)}`);
        }

        super.sendEvent(event);
    }

    /**
     * Overload sendRequest to log
     */
    public sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {
        logger.verbose(`To client: ${JSON.stringify(command)}(${JSON.stringify(args)}), timeout: ${timeout}`);

        super.sendRequest(command, args, timeout, cb);
    }

    /**
     * Overload sendResponse to log
     */
    public sendResponse(response: DebugProtocol.Response): void {
        logger.verbose(`To client: ${JSON.stringify(response)}`);
        super.sendResponse(response);
    }

    private onLog(msg: string, level: logger.LogLevel): void {
        const outputCategory = level === logger.LogLevel.Error ? 'stderr' : 'stdout';

        if (level === logger.LogLevel.Verbose) {
            // Distinguish verbose messages with this prefix - makes the logs much more readable
            msg = `  ›${msg}`;
        }

        this.sendEvent(new OutputEvent(msg, outputCategory));
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
            e => {
                if (e.format) {
                    this.sendErrorResponse(response, e as DebugProtocol.Message);
                    return;
                }

                const eStr = e ? e.message : 'Unknown error';
                if (eStr === 'Error: unknowncommand') {
                    this.sendErrorResponse(response, 1014, `[${this._extensionName}] Unrecognized request: ${request.command}`, null, ErrorDestination.Telemetry);
                    return;
                }

                if (request.command === 'evaluate') {
                    // Errors from evaluate show up in the console or watches pane. Doesn't seem right
                    // as it's not really a failed request. So it doesn't need the [extensionName] tag and worth special casing.
                    response.message = eStr;
                    response.success = false;
                    this.sendResponse(response);
                    return;
                } else {
                    this.failedRequest(request.command, response, e);
                }
            });
    }

    /**
     * Overload dispatchRequest to the debug adapters' Promise-based methods instead of DebugSession's callback-based methods
     */
    protected dispatchRequest(request: DebugProtocol.Request): void {
        const response = new Response(request);
        try {
            logger.verbose(`From client: ${request.command}(${JSON.stringify(request.arguments) })`);

            const responseP = (request.command in this._debugAdapter) ?
                Promise.resolve(this._debugAdapter[request.command](request.arguments, request.seq)) :
                utils.errP('unknowncommand');

            this.sendResponseAsync(
                request,
                response,
                responseP);
        } catch (e) {
            this.failedRequest(request.command, response, e);
        }
    }

    private failedRequest(requestType: string, response: DebugProtocol.Response, error: Error): void {
        logger.error(`Error processing "${requestType}": ${error.stack}`);

        // These errors show up in the message bar at the top (or nowhere), sometimes not obvious that they
        // come from the adapter, so add extensionName
        this.sendErrorResponse(
            response,
            1104,
            '[{_extensionName}] Error processing "{_requestType}": {_stack}',
            { _extensionName: this._extensionName, _requestType: requestType, _stack: error.stack },
            ErrorDestination.Telemetry);
    }
}

function logVersionInfo(): void {
    logger.log(`OS: ${os.platform()} ${os.arch()}`);
    logger.log(`Adapter node: ${process.version} ${process.arch}`);
    logger.log('vscode-chrome-debug-core: ' + require('../../../package.json').version);
}
