/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { logger, } from 'vscode-debugadapter';

import {
    ICommonRequestArgs, IScopesResponseBody, IVariablesResponseBody,
    IThreadsResponseBody, IEvaluateResponseBody, ISetVariableResponseBody,
    ICompletionsResponseBody, ITimeTravelRuntime
} from '../debugAdapterInterfaces';

import { ChromeConnection } from './chromeConnection';
import * as ChromeUtils from './chromeUtils';
import { Protocol as CDTP } from 'devtools-protocol';
import { PropertyContainer, ScopeContainer, ExceptionContainer, isIndexedPropName, IVariableContainer } from './variables';
import * as variables from './variables';
import { formatConsoleArguments, formatExceptionDetails, clearConsoleCode } from './consoleHelper';
import { ReasonType } from './stoppedEvent';
import { stackTraceWithoutLogpointFrame } from './internalSourceBreakpoint';

import * as errors from '../errors';
import * as utils from '../utils';
import { telemetry } from '../telemetry';

import { LineColTransformer } from '../transformers/lineNumberTransformer';
import { BasePathTransformer } from '../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../transformers/baseSourceMapTransformer';

import * as nls from 'vscode-nls';
import { ISession } from './client/session';
import { IScript } from './internal/scripts/script';

import { LocationInLoadedSource } from './internal/locations/location';
import { IEvaluateArguments, ICompletionsArguments } from './internal/requests';
import { LoadedSourceCallFrame, CallFrameWithState } from './internal/stackTraces/callFrame';
import { CodeFlowStackTrace } from './internal/stackTraces/codeFlowStackTrace';
import { IResourceIdentifier, parseResourceIdentifier } from './internal/sources/resourceIdentifier';
import { FormattedExceptionParser } from './internal/formattedExceptionParser';
import { injectable, inject } from 'inversify';
import { TYPES } from './dependencyInjection.ts/types';
import { ICDTPDebuggeeExecutionEventsProvider, PausedEvent } from './cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { ILogEntry, ILogEventsProvider } from './cdtpDebuggee/eventsProviders/cdtpLogEventsProvider';
import { IConsoleEventsProvider, IConsoleAPICalledEvent } from './cdtpDebuggee/eventsProviders/cdtpConsoleEventsProvider';
import { IPauseOnExceptionsConfigurer } from './cdtpDebuggee/features/cdtpPauseOnExceptionsConfigurer';
import { CDTPExceptionThrownEventsProvider, IExceptionThrownEvent } from './cdtpDebuggee/eventsProviders/cdtpExceptionThrownEventsProvider';
import { CDTPExecutionContextEventsProvider } from './cdtpDebuggee/eventsProviders/cdtpExecutionContextEventsProvider';
import { IDebuggeeStateSetter } from './cdtpDebuggee/features/cdtpDebugeeStateSetter';
import { IEvaluateOnCallFrameRequest, IDebuggeeStateInspector } from './cdtpDebuggee/features/cdtpDebugeeStateInspector';
import { ConnectedCDAConfiguration } from './client/chromeDebugAdapter/cdaConfiguration';
import { CDTPScriptsRegistry } from './cdtpDebuggee/registries/cdtpScriptsRegistry';
import { EventsToClientReporter } from './client/eventsToClientReporter';
import { validateNonPrimitiveRemoteObject, CDTPNonPrimitiveRemoteObject, CDTPRemoteObjectOfTypeObject, validateCDTPRemoteObjectOfTypeObject } from './cdtpDebuggee/cdtpPrimitives';
import { isTrue, isNotNull, isNotEmpty, isUndefined, isDefined, hasElements, isEmpty } from './utils/typedOperators';
import * as _ from 'lodash';
import { CurrentStackTraceProvider } from './internal/stackTraces/currentStackTraceProvider';

let localize = nls.loadMessageBundle();

interface IPropCount {
    indexedVariables: number | undefined;
    namedVariables: number | undefined;
}

/**
 * Represents a reference to a source/script. `contents` is set if there are inlined sources.
 * Otherwise, scriptId can be used to retrieve the contents from the runtime.
 */
export interface ISourceContainer {
    /** The runtime-side scriptId of this script */
    scriptId?: IScript;
    /** The contents of this script, if they are inlined in the sourcemap */
    contents?: string;
    /** The authored path to this script (only set if the contents are inlined) */
    mappedPath?: string;
}

export type VariableContext = 'variables' | 'watch' | 'repl' | 'hover';

export type CrdpScript = CDTP.Debugger.ScriptParsedEvent;

export type CrdpDomain = string;

export type LoadedSourceEventReason = 'new' | 'changed' | 'removed';

@injectable()
export class ChromeDebugLogic {
    public static EVAL_NAME_PREFIX = ChromeUtils.EVAL_NAME_PREFIX;
    public static EVAL_ROOT = '<eval>';

    public static THREAD_ID = 1;
    static HITCONDITION_MATCHER: any;

    public _session: ISession;
    public _domains = new Map<CrdpDomain, CDTP.Schema.Domain>();
    private _expectingResumedEvent = false;
    public _expectingStopReason: ReasonType | undefined;
    private _waitAfterStep = Promise.resolve();

    private _variableHandles: variables.VariableHandles;

    private _lineColTransformer: LineColTransformer;
    public _pathTransformer: BasePathTransformer;

    public readonly _launchAttachArgs: ICommonRequestArgs = this._configuration.args;

    private _currentLogMessage = Promise.resolve();
    privaRejectExceptionFilterEnabled = false;

    private readonly _chromeConnection: ChromeConnection;
    private readonly _sourceMapTransformer: BaseSourceMapTransformer;
    public _promiseRejectExceptionFilterEnabled = false;
    public _pauseOnPromiseRejections = true;

    private readonly _currentStackStraceProvider = new CurrentStackTraceProvider(this._cdtpDebuggeeExecutionEventsProvider);

    public constructor(
        @inject(TYPES.LineColTransformer) lineColTransformer: LineColTransformer,
        @inject(TYPES.BaseSourceMapTransformer) sourceMapTransformer: BaseSourceMapTransformer,
        @inject(TYPES.BasePathTransformer) pathTransformer: BasePathTransformer,
        @inject(TYPES.ISession) session: ISession,
        @inject(TYPES.ChromeConnection) chromeConnection: ChromeConnection,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsLogic: CDTPScriptsRegistry,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventSender: EventsToClientReporter,
        @inject(TYPES.ExceptionThrownEventProvider) private readonly _exceptionThrownEventProvider: CDTPExceptionThrownEventsProvider,
        @inject(TYPES.ExecutionContextEventsProvider) private readonly _executionContextEventsProvider: CDTPExecutionContextEventsProvider,
        @inject(TYPES.IDebuggeeStateInspector) private readonly _inspectDebuggeeState: IDebuggeeStateInspector,
        @inject(TYPES.IUpdateDebuggeeState) private readonly _updateDebuggeeState: IDebuggeeStateSetter,
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.ICDTPDebuggeeExecutionEventsProvider) private readonly _cdtpDebuggeeExecutionEventsProvider: ICDTPDebuggeeExecutionEventsProvider,
        @inject(TYPES.ICDTPDebuggeeExecutionEventsProvider) private readonly _debuggerEvents: ICDTPDebuggeeExecutionEventsProvider,
        @inject(TYPES.IConsoleEventsProvider) private readonly _consoleEventsProvider: IConsoleEventsProvider,
        @inject(TYPES.ILogEventsProvider) private readonly _logEventsProvider: ILogEventsProvider,
        @inject(TYPES.IPauseOnExceptions) private readonly _pauseOnExceptions: IPauseOnExceptionsConfigurer,
    ) {
        telemetry.setupEventHandler(e => session.sendEvent(e));
        this._session = session;
        this._chromeConnection = chromeConnection;

        this._variableHandles = new variables.VariableHandles();

        this._lineColTransformer = lineColTransformer;
        this._sourceMapTransformer = sourceMapTransformer;
        this._pathTransformer = pathTransformer;

        this.clearTargetContext();
    }

    public get pathTransformer(): BasePathTransformer {
        return this._pathTransformer;
    }

    public get sourceMapTransformer(): BaseSourceMapTransformer {
        return this._sourceMapTransformer;
    }

    /**
     * Called on 'clearEverything' or on a navigation/refresh
     */
    protected clearTargetContext(): void {
        this._sourceMapTransformer.clearTargetContext();
        this._pathTransformer.clearTargetContext();
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

    /**
     * Hook up all connection events
     */
    public install(): ChromeDebugLogic {
        this._debuggerEvents.onResumed(() => this.onResumed());
        this._debuggerEvents.onPaused(paused => this.onPaused(paused));
        this._consoleEventsProvider.onMessageAdded(params => this.onMessageAdded(params));
        this._consoleEventsProvider.onConsoleAPICalled(params => this.onConsoleAPICalled(params));
        this._exceptionThrownEventProvider.onExceptionThrown(params => this.onExceptionThrown(params));
        this._executionContextEventsProvider.onExecutionContextsCleared(() => this.clearTargetContext());
        this._logEventsProvider.onEntryAdded(entry => this.onLogEntryAdded(entry));

        return this;
    }

    // private async runAndMeasureProcessingTime<Result>(notificationName: string, procedure: () => Promise<Result>): Promise<Result> {
    //     const startTime = Date.now();
    //     const startTimeMark = process.hrtime();
    //     let properties: IExecutionResultTelemetryProperties = {
    //         startTime: startTime.toString()
    //     };

    //     try {
    //         return await procedure();
    //         properties.successful = 'true';
    //     } catch (e) {
    //         properties.successful = 'false';
    //         properties.exceptionType = 'firstChance';
    //         utils.fillErrorDetails(properties, e);
    //         throw e;
    //     } finally {
    //         const elapsedTime = utils.calculateElapsedTime(startTimeMark);
    //         properties.timeTakenInMilliseconds = elapsedTime.toString();

    //         // Callers set GDPR annotation
    //         this._batchTelemetryReporter.reportEvent(notificationName, properties);
    //     }
    // }

    public onResumed(): void {
        if (this._expectingResumedEvent) {
            this._expectingResumedEvent = false;

            // Need to wait to eval just a little after each step, because of #148
            this._waitAfterStep = utils.promiseTimeout(undefined, 50);
        }
    }

    public async onConsoleAPICalled(event: IConsoleAPICalledEvent): Promise<void> {
        if (isTrue(this._launchAttachArgs._suppressConsoleOutput)) {
            return;
        }

        const result = formatConsoleArguments(event.type, event.args, event.stackTrace);
        const stack = isDefined(event.stackTrace) ? stackTraceWithoutLogpointFrame(event.stackTrace) : undefined;
        if (isNotNull(result)) {
            return this.logObjects(result.args, result.isError, stack);
        }
    }

    private async onLogEntryAdded(entry: ILogEntry): Promise<void> {
        // The Debug Console doesn't give the user a way to filter by level, just ignore 'verbose' logs
        if (entry.level === 'verbose') {
            return;
        }

        const args = _.defaultTo(entry.args, [] as CDTP.Runtime.RemoteObject[]);

        let text = _.defaultTo(entry.text, '');
        if (isNotEmpty(entry.url) && isUndefined(entry.stackTrace)) {
            if (isNotEmpty(text)) {
                text += ' ';
            }

            text += `[${entry.url}]`;
        }

        if (isNotEmpty(text)) {
            args.unshift({
                type: 'string',
                value: text
            });
        }

        const type = entry.level === 'error' ? 'error' :
            entry.level === 'warning' ? 'warning' :
                'log';
        const result = formatConsoleArguments(type, args, entry.stackTrace);
        const stack = entry.stackTrace;
        if (isNotNull(result)) {
            return this.logObjects(result.args, result.isError, stack);
        }
    }

    private async logObjects(objs: CDTP.Runtime.RemoteObject[], isError = false, stackTrace?: CodeFlowStackTrace): Promise<void> {
        // This is an asynchronous method, so ensure that we handle one at a time so that they are sent out in the same order that they came in.
        this._currentLogMessage = this._currentLogMessage
            .then(async () => {
                const category = isError ? 'stderr' : 'stdout';

                let location: LocationInLoadedSource | undefined = undefined;
                if (isDefined(stackTrace) && hasElements(stackTrace.codeFlowFrames)) {
                    location = stackTrace.codeFlowFrames[0].location.mappedToSource();
                }

                // Shortcut the common log case to reduce unnecessary back and forth
                if (objs.length === 1 && objs[0].type === 'string') {
                    let msg: string = objs[0].value;
                    if (isError) {
                        const stackTrace = await new FormattedExceptionParser(this._scriptsLogic, msg).parse();
                        return this._eventSender.sendExceptionThrown({ exceptionStackTrace: stackTrace, category, location });
                    } else {
                        if (!msg.endsWith(clearConsoleCode)) {
                            // If this string will clear the console, don't append a \n
                            msg += '\n';
                        }
                        return this._eventSender.sendOutput({ output: msg, category, location });
                    }
                } else {
                    const variablesReference = this._variableHandles.create(new variables.LoggedObjects(objs), 'repl');
                    return this._eventSender.sendOutput({ output: 'output', category, variablesReference, location });
                }

            })
            .catch(err => logger.error(err.toString()));
    }

    protected async onExceptionThrown(params: IExceptionThrownEvent): Promise<void> {
        if (isTrue(this._launchAttachArgs._suppressConsoleOutput)) {
            return;
        }

        return this._currentLogMessage = this._currentLogMessage.then(async () => {
            const formattedException = formatExceptionDetails(params.exceptionDetails);
            const exceptionStackTrace = await new FormattedExceptionParser(this._scriptsLogic, formattedException).parse();

            let location: LocationInLoadedSource | undefined = undefined;
            const stackTrace = params.exceptionDetails.stackTrace;
            if (isDefined(stackTrace) && hasElements(stackTrace.codeFlowFrames)) {
                location = stackTrace.codeFlowFrames[0].location.mappedToSource();
            }

            return this._eventSender.sendExceptionThrown({ exceptionStackTrace: exceptionStackTrace, category: 'stderr', location });
        })
            .catch(err => logger.error(err.toString()));
    }

    /**
     * For backcompat, also listen to Console.messageAdded, only if it looks like the old format.
     */
    protected async onMessageAdded(params: any): Promise<void> {
        // message.type is undefined when Runtime.consoleAPICalled is being sent
        if (params && params.message && params.message.type) {
            const onConsoleAPICalledParams: IConsoleAPICalledEvent = {
                type: params.message.type,
                timestamp: params.message.timestamp,
                args: _.defaultTo(params.message.parameters, [{ type: 'string', value: params.message.text }]),
                stackTrace: params.message.stack,
                executionContextId: 1
            };
            await this.onConsoleAPICalled(onConsoleAPICalledParams);
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

        return this._pauseOnExceptions.setPauseOnExceptions({ state })
            .then(() => { });
    }

    public stepBack(): Promise<void> {
        return (<ITimeTravelRuntime>this._chromeConnection.api).TimeTravel.stepBack()
            .then(() => { /* make void */ },
                () => { });
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
        return (<ITimeTravelRuntime>this._chromeConnection.api).TimeTravel.reverse()
            .then(() => { /* make void */ },
                () => { });
    }

    public getReadonlyOrigin(): string | undefined {
        // To override
        return undefined;
    }

    /**
     * Called when returning a stack trace, for the path for Sources that have a sourceReference, so consumers can
     * tweak it, since it's only for display.
     */
    protected realPathToDisplayPath(realPath: IResourceIdentifier): IResourceIdentifier {
        if (ChromeUtils.isEvalScript(realPath)) {
            return parseResourceIdentifier(`${ChromeDebugLogic.EVAL_ROOT}/${realPath}`);
        }

        return realPath;
    }

    /* __GDPR__
        "ClientRequest/scopes" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public scopes(currentFrame: LoadedSourceCallFrame<CallFrameWithState>): IScopesResponseBody {
        if (isUndefined(currentFrame) || isUndefined(currentFrame.location)) {
            throw errors.stackFrameNotValid();
        }

        const scopes = currentFrame.state.scopeChain.map((scope, i) => {
            // The first scope should include 'this'. Keep the RemoteObject reference for use by the variables request
            const thisObj = i === 0 ? currentFrame.state.frameThis : undefined;
            const returnValue = i === 0 ? currentFrame.state.returnValue : undefined;
            const variablesReference = this._variableHandles.create(
                new ScopeContainer(currentFrame, i, scope.object.objectId, thisObj, returnValue));

            const resultScope = <DebugProtocol.Scope>{
                name: scope.type.substr(0, 1).toUpperCase() + scope.type.substr(1), // Take Chrome's scope, uppercase the first letter
                variablesReference,
                expensive: scope.type === 'global'
            };

            if (isDefined(scope.startLocation) && isDefined(scope.endLocation)) {
                resultScope.column = scope.startLocation.position.columnNumber;
                resultScope.line = scope.startLocation.position.lineNumber;
                resultScope.endColumn = scope.endLocation.position.columnNumber;
                resultScope.endLine = scope.endLocation.position.lineNumber;
            }

            return resultScope;
        });

        if (currentFrame.index === 0) {
            this._currentStackStraceProvider.ifExceptionWasThrown(exception => {
                scopes.unshift(<DebugProtocol.Scope>{
                    name: localize('scope.exception', 'Exception'),
                    variablesReference: this._variableHandles.create(ExceptionContainer.create(exception))
                });
            }, () => {});
        }

        const scopesResponse = { scopes };
        if (currentFrame.source.doesScriptHasUrl()) {
            this._sourceMapTransformer.scopesResponse(currentFrame.source.url, scopesResponse);
            this._lineColTransformer.scopeResponse(scopesResponse);
        }

        return scopesResponse;
    }

    /* __GDPR__
        "ClientRequest/variables" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public variables(args: DebugProtocol.VariablesArguments): Promise<IVariablesResponseBody | undefined> {
        const handle = this._variableHandles.get(args.variablesReference);
        if (isUndefined(handle)) {
            return Promise.resolve(undefined);
        }

        return handle.expand(this, args.filter, args.start, args.count)
            .catch(err => {
                logger.log('Error handling variables request: ' + err.toString());
                return [];
            }).then(variables => {
                return { variables };
            });
    }

    public async propertyDescriptorToVariable(propDesc: CDTP.Runtime.PropertyDescriptor, owningObjectId?: string, parentEvaluateName?: string): Promise<DebugProtocol.Variable> {
        if (isDefined(propDesc.get)) {
            // Getter
            const grabGetterValue = 'function remoteFunction(propName) { return this[propName]; }';

            let response: CDTP.Runtime.CallFunctionOnResponse;
            try {
                response = await this._inspectDebuggeeState.callFunctionOn({
                    objectId: owningObjectId,
                    functionDeclaration: grabGetterValue,
                    arguments: [{ value: propDesc.name }]
                });
            } catch (error) {
                logger.error(`Error evaluating getter for '${propDesc.name}' - ${error.toString()}`);
                return { name: propDesc.name, value: error.toString(), variablesReference: 0 };
            }

            if (isDefined(response.exceptionDetails)) {
                // Not an error, getter could be `get foo() { throw new Error('bar'); }`
                const exceptionMessage = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                logger.verbose('Exception thrown evaluating getter - ' + exceptionMessage);
                return { name: propDesc.name, value: exceptionMessage, variablesReference: 0 };
            } else {
                return this.remoteObjectToVariable(propDesc.name, response.result, parentEvaluateName);
            }
        } else if (isDefined(propDesc.set)) {
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
            const propsByName = new Map<string, CDTP.Runtime.PropertyDescriptor>();
            const internalPropsByName = new Map<string, CDTP.Runtime.InternalPropertyDescriptor>();
            getPropsResponses.forEach(response => {
                if (isNotNull(response)) {
                    response.result.forEach(propDesc =>
                        propsByName.set(propDesc.name, propDesc));

                    if (isDefined(response.internalProperties)) {
                        response.internalProperties.forEach(internalProp => {
                            internalPropsByName.set(internalProp.name, internalProp);
                        });
                    }
                }
            });

            // Convert Chrome prop descriptors to DebugProtocol vars
            const variables: Promise<DebugProtocol.Variable>[] = [];
            propsByName.forEach(propDesc => {
                if (isEmpty(filter) || filter === 'all' || (isIndexedPropName(propDesc.name) === (filter === 'indexed'))) {
                    variables.push(this.propertyDescriptorToVariable(propDesc, objectId, evaluateName));
                }
            });

            internalPropsByName.forEach(internalProp => {
                if (isEmpty(filter) || filter === 'all' || (isIndexedPropName(internalProp.name) === (filter === 'indexed'))) {
                    variables.push(Promise.resolve(this.internalPropertyDescriptorToVariable(internalProp, evaluateName)));
                }
            });

            return Promise.all(variables);
        }).then(variables => {
            // Sort all variables properly
            return variables.sort((var1, var2) => ChromeUtils.compareVariableNames(var1.name, var2.name));
        });
    }

    private getRuntimeProperties(params: CDTP.Runtime.GetPropertiesRequest): Promise<CDTP.Runtime.GetPropertiesResponse | null> {
        return this._inspectDebuggeeState.getProperties(params)
            .catch(err => {
                if (err.message.startsWith('Cannot find context with specified id')) {
                    // Hack to ignore this error until we fix https://github.com/Microsoft/client/issues/18001 to not request variables at unexpected times.
                    return null;
                } else {
                    throw err;
                }
            });
    }

    private internalPropertyDescriptorToVariable(propDesc: CDTP.Runtime.InternalPropertyDescriptor, parentEvaluateName?: string): Promise<DebugProtocol.Variable> {
        return this.remoteObjectToVariable(propDesc.name, propDesc.value, parentEvaluateName);
    }

    private getFilteredVariablesForObject(objectId: string, evaluateName: string | undefined, filter: string | undefined, start: number, count: number): Promise<DebugProtocol.Variable[]> {
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

    private getFilteredVariablesForObjectId(objectId: string, evaluateName: string | undefined, getVarsFn: string, filter: string | undefined, start: number, count: number): Promise<DebugProtocol.Variable[]> {
        return this._inspectDebuggeeState.callFunctionOn({
            objectId,
            functionDeclaration: getVarsFn,
            arguments: [{ value: start }, { value: count }],
            silent: true
        }).then<DebugProtocol.Variable[]>(evalResponse => {
            if (isDefined(evalResponse.exceptionDetails)) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(evalResponse.exceptionDetails);
                return Promise.reject(errors.errorFromEvaluate(errMsg));
            } else if (isNotEmpty(evalResponse.result.objectId)) {
                // The eval was successful and returned a reference to the array object. Get the props, then filter
                // out everything except the index names.
                return this.getVariablesForObjectId(evalResponse.result.objectId, evaluateName, filter)
                    .then(variables => variables.filter(variable => isIndexedPropName(variable.name)));
            } else {
                throw new Error(`Expected the response to the evaluate to be an array with an objectId, yet the object it was missing. Response: ${JSON.stringify(evalResponse)}`);
            }
        },
            error => Promise.reject(errors.errorFromEvaluate(error.message)));
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
                    id: ChromeDebugLogic.THREAD_ID,
                    name: this.threadName()
                }
            ]
        };
    }

    protected threadName(): string {
        return 'Thread ' + ChromeDebugLogic.THREAD_ID;
    }

    /* __GDPR__
        "ClientRequest/evaluate" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async evaluate(args: IEvaluateArguments): Promise<IEvaluateResponseBody> {
        const expression = args.expression.startsWith('{') && args.expression.endsWith('}')
            ? `(${args.expression})`
            : args.expression;

        const evalResponse = await this.waitThenDoEvaluate(expression, args.frame, { generatePreview: true });

        // Convert to a Variable object then just copy the relevant fields off
        const variable = await this.remoteObjectToVariable(expression, evalResponse.result, /*parentEvaluateName=*/undefined, /*stringify=*/undefined, <VariableContext>args.context);
        if (isDefined(evalResponse.exceptionDetails)) {
            let resultValue = variable.value;
            if (isNotEmpty(resultValue) && (resultValue.startsWith('ReferenceError: ') || resultValue.startsWith('TypeError: ')) && args.context !== 'repl') {
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
     * Allow consumers to override just because of https://github.com/nodejs/node/issues/8426
     */
    public globalEvaluate(args: CDTP.Runtime.EvaluateRequest): Promise<CDTP.Runtime.EvaluateResponse> {
        return this._inspectDebuggeeState.evaluate(args);
    }

    private async waitThenDoEvaluate(expression: string, frame?: LoadedSourceCallFrame<CallFrameWithState>, extraArgs?: Partial<CDTP.Runtime.EvaluateRequest>): Promise<CDTP.Debugger.EvaluateOnCallFrameResponse | CDTP.Runtime.EvaluateResponse> {
        const waitThenEval = this._waitAfterStep.then(() => this.doEvaluate(expression, frame, extraArgs));
        this._waitAfterStep = waitThenEval.then(() => { }, () => { }); // to Promise<void> and handle failed evals
        return waitThenEval;
    }

    private async doEvaluate(expression: string, frame: LoadedSourceCallFrame<CallFrameWithState> | undefined, extraArgs?: Partial<CDTP.Runtime.EvaluateRequest>): Promise<CDTP.Debugger.EvaluateOnCallFrameResponse | CDTP.Runtime.EvaluateResponse> {
        if (isDefined(frame)) {
            return this.evaluateOnCallFrame(expression, frame, extraArgs);
        } else {
            let args: CDTP.Runtime.EvaluateRequest = {
                expression,
                // silent because of an issue where node will sometimes hang when breaking on exceptions in console messages. Fixed somewhere between 8 and 8.4
                silent: true,
                includeCommandLineAPI: true,
                objectGroup: 'console',
                userGesture: true
            };
            if (isDefined(extraArgs)) {
                args = Object.assign(args, extraArgs);
            }

            return this.globalEvaluate(args);
        }
    }

    public async evaluateOnCallFrame(expression: string, frame: LoadedSourceCallFrame<CallFrameWithState>, extraArgs?: Partial<CDTP.Runtime.EvaluateRequest>): Promise<CDTP.Debugger.EvaluateOnCallFrameResponse | CDTP.Runtime.EvaluateResponse> {
        let args: IEvaluateOnCallFrameRequest = {
            frame: frame.unmappedCallFrame,
            expression,
            // silent because of an issue where node will sometimes hang when breaking on exceptions in console messages. Fixed somewhere between 8 and 8.4
            silent: true,
            includeCommandLineAPI: true,
            objectGroup: 'console'
        };
        if (isDefined(extraArgs)) {
            args = Object.assign(args, extraArgs);
        }

        return this._inspectDebuggeeState.evaluateOnCallFrame(args);
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
        if (isUndefined(handle)) {
            return Promise.reject(errors.setValueNotSupported());
        }

        return handle.setValue(this, args.name, args.value)
            .then(value => ({ value }));
    }

    public setVariableValue(frame: LoadedSourceCallFrame<CallFrameWithState>, scopeNumber: number, variableName: string, value: string): Promise<string> {
        let evalResultObject: CDTP.Runtime.RemoteObject;
        return this._inspectDebuggeeState.evaluateOnCallFrame({ frame: frame.unmappedCallFrame, expression: value, silent: true }).then(evalResponse => {
            if (isDefined(evalResponse.exceptionDetails)) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(evalResponse.exceptionDetails);
                return Promise.reject(errors.errorFromEvaluate(errMsg));
            } else {
                evalResultObject = evalResponse.result;
                const newValue = ChromeUtils.remoteObjectToCallArgument(evalResultObject);
                return this._updateDebuggeeState.setVariableValue({ frame: frame.unmappedCallFrame, scopeNumber, variableName, newValue });
            }
        },
            error => Promise.reject(errors.errorFromEvaluate(error.message)))
            // Temporary, Microsoft/vscode#12019
            .then(() => ChromeUtils.remoteObjectToValue(evalResultObject).value);
    }

    public setPropertyValue(objectId: string, propName: string, value: string): Promise<string> {
        const setPropertyValueFn = `function() { return this["${propName}"] = ${value} }`;
        return this._inspectDebuggeeState.callFunctionOn({
            objectId, functionDeclaration: setPropertyValueFn,
            silent: true
        }).then(response => {
            if (isDefined(response.exceptionDetails)) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                return Promise.reject<string>(errors.errorFromEvaluate(errMsg));
            } else {
                // Temporary, Microsoft/vscode#12019
                return ChromeUtils.remoteObjectToValue(response.result).value;
            }
        },
            error => Promise.reject<string>(errors.errorFromEvaluate(error.message)));
    }

    public async remoteObjectToVariable(name: string, object?: CDTP.Runtime.RemoteObject, parentEvaluateName?: string, stringify = true, context: VariableContext = 'variables'): Promise<DebugProtocol.Variable> {
        name = _.defaultTo(name, '""');

        if (isDefined(object)) {
            if (object.type === 'object' && (object.subtype === 'null' || (<string>object.subtype) === 'internal#location')) {
                // Could format this nicely later, see #110
                return this.createPrimitiveVariableWithValue(name, object.subtype!, parentEvaluateName);
            } else if (object.type === 'object' && object.subtype !== 'null' && validateNonPrimitiveRemoteObject(object)) {
                return this.createObjectVariable(name, object, parentEvaluateName, context);
            } else if (object.type === 'function' && validateNonPrimitiveRemoteObject(object)) {
                return this.createFunctionVariable(name, object, context, parentEvaluateName);
            } else {
                return this.createPrimitiveVariable(name, object, parentEvaluateName, stringify);
            }
        } else {
            return this.createPrimitiveVariableWithValue(name, '', parentEvaluateName);
        }
    }

    public createFunctionVariable(name: string, object: CDTPNonPrimitiveRemoteObject, context: VariableContext, parentEvaluateName?: string): DebugProtocol.Variable {
        if (object.description === undefined) {
            throw new Error(`Expected to find a description property in the remote object of a function: ${JSON.stringify(object)}`);
        }

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

    public createObjectVariable(name: string, object: CDTPNonPrimitiveRemoteObject, parentEvaluateName: string | undefined, context: VariableContext): Promise<DebugProtocol.Variable> {
        const value = variables.getRemoteObjectPreview_object(object, context);
        let propCountP: Promise<IPropCount>;
        if (object.subtype === 'array' || object.subtype === 'typedarray') {
            if (isDefined(object.preview) && !object.preview.overflow) {
                propCountP = Promise.resolve(this.getArrayNumPropsByPreview(object));
            } else if (object.className === 'Buffer') {
                propCountP = this.getBufferNumPropsByEval(object.objectId);
            } else {
                propCountP = this.getArrayNumPropsByEval(object.objectId);
            }
        } else if (object.subtype === 'set' || object.subtype === 'map') {
            if (validateCDTPRemoteObjectOfTypeObject(object) && !object.preview.overflow) {
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

    protected createPropertyContainer(object: CDTPNonPrimitiveRemoteObject, evaluateName: string): IVariableContainer {
        return new PropertyContainer(object.objectId, evaluateName);
    }

    public createPrimitiveVariable(name: string, object: CDTP.Runtime.RemoteObject, parentEvaluateName?: string, stringify?: boolean): DebugProtocol.Variable {
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
        "ClientRequest/completions" : {
            "${include}": [
                "${IExecutionResultTelemetryProperties}",
                "${DebugCommonProperties}"
            ]
        }
    */
    public async completions(args: ICompletionsArguments): Promise<ICompletionsResponseBody> {
        const text = args.text;
        const column = args.column;

        // 1-indexed column
        const prefix = text.substring(0, column - 1);

        let expression: string | undefined = undefined;
        const dot = prefix.lastIndexOf('.');
        if (dot >= 0) {
            expression = prefix.substr(0, dot);
        }

        if (isDefined(args.frame) && isEmpty(expression)) {
            logger.verbose(`Completions: Returning global completions`);

            const callFrame = args.frame;

            const scopeExpandPs = callFrame.state.scopeChain
                .map((scope, i) => new ScopeContainer(callFrame, i, scope.object.objectId).expand(this));
            return Promise.all(scopeExpandPs)
                .then((variableArrs: DebugProtocol.Variable[][]) => {
                    const targets = this.getFlatAndUniqueCompletionItems(
                        variableArrs.map(variableArr => variableArr.map(variable => variable.name)));
                    return { targets };
                });
        } else {
            expression = _.defaultTo(expression, 'this');

            logger.verbose(`Completions: Returning for expression '${expression}'`);
            const getCompletionsFn = `(function(x){var a=[];for(var o=x;o!==null&&typeof o !== 'undefined';o=o.__proto__){a.push(Object.getOwnPropertyNames(o))};return a})(${expression})`;
            const response = await this.waitThenDoEvaluate(getCompletionsFn, args.frame, { returnByValue: true });
            if (isDefined(response.exceptionDetails)) {
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

    private getArrayNumPropsByPreview(object: CDTP.Runtime.RemoteObject): IPropCount {
        if (object.preview === undefined) {
            throw new Error(`Expected to find a preview property in the remote object of an array: ${JSON.stringify(object)}`);
        }

        let indexedVariables = 0;

        const indexedProps = object.preview.properties
            .filter(prop => isIndexedPropName(prop.name));
        if (indexedProps.length > 0) {
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

    private getCollectionNumPropsByPreview(object: CDTPRemoteObjectOfTypeObject): IPropCount {
        let indexedVariables = 0;
        let namedVariables = object.preview.properties.length + 1; // +1 for [[Entries]];

        return { indexedVariables, namedVariables };
    }

    private getNumPropsByEval(objectId: string, getNumPropsFn: string): Promise<IPropCount> {
        return this._inspectDebuggeeState.callFunctionOn({
            objectId,
            functionDeclaration: getNumPropsFn,
            silent: true,
            returnByValue: true
        }).then(response => {
            if (isDefined(response.exceptionDetails)) {
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

    public async onPaused(_notification: PausedEvent): Promise<void> {
        this._variableHandles.onPaused();
    }

    public toString(): string {
        return 'ChromeDebugLogic';
    }
}
