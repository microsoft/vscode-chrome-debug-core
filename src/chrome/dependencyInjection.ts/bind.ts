/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Container, interfaces } from 'inversify';
import { TYPES } from './types';

import { IStackTracePresentationDetailsProvider, StackTracePresenter } from '../internal/stackTraces/stackTracePresenter';
import { SourcesRetriever } from '../internal/sources/sourcesRetriever';
import { PauseOnExceptionOrRejection } from '../internal/exceptions/pauseOnException';
import { SteppingRequestsHandler } from '../internal/stepping/steppingRequestsHandler';
import { DotScriptCommand } from '../internal/sources/features/dotScriptsCommand';
import { SyncStepping } from '../internal/stepping/features/syncStepping';
import { AsyncStepping } from '../internal/stepping/features/asyncStepping';
import { SmartStepLogic } from '../internal/features/smartStep';
import { LineColTransformer } from '../../transformers/lineNumberTransformer';
import { ChromeDebugLogic } from '../chromeDebugAdapter';
import { ComponentCustomizationCallback } from './di';
import { MethodsCalledLogger, MethodsCalledLoggerConfiguration } from '../logging/methodsCalledLogger';
import { printTopLevelObjectDescription } from '../logging/printObjectDescription';
import { SkipFilesLogic } from '../internal/features/skipFiles';
import { ToggleSkipFileStatusRequestHandler } from '../internal/features/toggleSkipFileStatusRequestHandler';
import { SourceRequestHandler } from '../internal/sources/sourceRequestHandler';
import { PauseOnExceptionRequestHandlers } from '../internal/exceptions/pauseOnExceptionRequestHandlers';
import { StackTraceRequestHandler } from '../internal/stackTraces/stackTraceRequestHandler';
import { ThreadsRequestHandler } from '../client/threadsRequestHandler';
import { ClientLifecycleRequestsHandler } from '../client/clientLifecycleRequestsHandler';
import { EvaluateRequestHandler } from '../internal/variables/evaluateRequestHandler';
import { ScopesRequestHandler } from '../internal/variables/scopesRequestHandler';
import { VariablesRequestHandler } from '../internal/variables/variablesRequestHandler';
import { DebuggeePausedHandler } from '../internal/features/debuggeePausedHandler';
import { EagerSourceMapTransformer } from '../../transformers/eagerSourceMapTransformer';
import { ConfigurationBasedPathTransformer } from '../../transformers/configurationBasedPathTransformer';
import { EventsToClientReporter } from '../client/eventsToClientReporter';
import { UninitializedCDA } from '../client/chromeDebugAdapter/uninitializedCDA';
import { UnconnectedCDA } from '../client/chromeDebugAdapter/unconnectedCDA';
import { ConnectingCDA } from '../client/chromeDebugAdapter/connectingCDA';
import { ConnectedCDA } from '../client/chromeDebugAdapter/connectedCDA';
import { SupportedDomains } from '../internal/domains/supportedDomains';
import { TerminatingCDA } from '../client/chromeDebugAdapter/terminatingCDA';
import { isDefined } from '../utils/typedOperators';
import { CompletionsRequestHandler } from '../internal/completions/completionsRequestHandler';
import { SourceToClientConverter } from '../client/sourceToClientConverter';
import { NotifyClientOfLoadedSources } from '../internal/sources/features/notifyClientOfLoadedSources';
import { logger } from 'vscode-debugadapter';

// TODO: This file needs a lot of work. We need to improve/simplify all this code when possible
interface IHasContainerName {
    __containerName: string;
}

export function bindAll(loggingConfiguration: MethodsCalledLoggerConfiguration, di: Container, callback: ComponentCustomizationCallback) {
    bind<IStackTracePresentationDetailsProvider>(loggingConfiguration, di, TYPES.IStackTracePresentationLogicProvider, SmartStepLogic, callback);
    bind<IStackTracePresentationDetailsProvider>(loggingConfiguration, di, TYPES.IStackTracePresentationLogicProvider, SkipFilesLogic, callback);
    bind(loggingConfiguration, di, TYPES.IEventsToClientReporter, EventsToClientReporter, callback);
    bind(loggingConfiguration, di, TYPES.ChromeDebugLogic, ChromeDebugLogic, callback);
    bind(loggingConfiguration, di, TYPES.ISourcesRetriever, SourcesRetriever, callback);
    bind(loggingConfiguration, di, TYPES.SourceToClientConverter, SourceToClientConverter, callback);

    bind(loggingConfiguration, di, TYPES.StackTracesLogic, StackTracePresenter, callback);
    bind(loggingConfiguration, di, TYPES.PauseOnExceptionOrRejection, PauseOnExceptionOrRejection, callback);
    bind(loggingConfiguration, di, TYPES.DotScriptCommand, DotScriptCommand, callback);
    //  bind<BaseSourceMapTransformer>(configuration, di, TYPES.BaseSourceMapTransformer, BaseSourceMapTransformer, callback);
    //  bind<BasePathTransformer>(configuration, di, TYPES.BasePathTransformer, BasePathTransformer, callback);
    //  bind<IStackTracePresentationLogicProvider>(configuration, di, TYPES.IStackTracePresentationLogicProvider, SkipFilesLogic, callback);
    bind(loggingConfiguration, di, TYPES.SyncStepping, SyncStepping, callback);
    bind(loggingConfiguration, di, TYPES.AsyncStepping, AsyncStepping, callback);
    // bind<cdtpBreakpointIdsRegistry>(configuration, di, cdtpBreakpointIdsRegistry, cdtpBreakpointIdsRegistry, callback);
    bind(loggingConfiguration, di, TYPES.LineColTransformer, LineColTransformer, callback);

    bind(loggingConfiguration, di, TYPES.IDebuggeePausedHandler, DebuggeePausedHandler, callback);

    // Command handler declarers
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, ClientLifecycleRequestsHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, EvaluateRequestHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, PauseOnExceptionRequestHandlers, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, ScopesRequestHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, SourceRequestHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, StackTraceRequestHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, SteppingRequestsHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, ThreadsRequestHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, ToggleSkipFileStatusRequestHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, VariablesRequestHandler, callback);
    bind(loggingConfiguration, di, TYPES.ICommandHandlerDeclarer, CompletionsRequestHandler, callback);

    bind(loggingConfiguration, di, TYPES.BaseSourceMapTransformer, EagerSourceMapTransformer, callback);
    bind(loggingConfiguration, di, TYPES.BasePathTransformer, ConfigurationBasedPathTransformer, callback);
    bind(loggingConfiguration, di, TYPES.UninitializedCDA, UninitializedCDA, callback);
    bind(loggingConfiguration, di, TYPES.UnconnectedCDA, UnconnectedCDA, callback);
    bind(loggingConfiguration, di, TYPES.ConnectingCDA, ConnectingCDA, callback);
    bind(loggingConfiguration, di, TYPES.ConnectedCDA, ConnectedCDA, callback);
    bind(loggingConfiguration, di, TYPES.ISupportedDomains, SupportedDomains, callback);
    bind(loggingConfiguration, di, TYPES.TerminatingCDA, TerminatingCDA, callback);

    // Services
    bind(loggingConfiguration, di, TYPES.IServiceComponent, NotifyClientOfLoadedSources, callback);
}

function bind<T extends object>(configuration: MethodsCalledLoggerConfiguration, container: Container,
    serviceIdentifier: interfaces.ServiceIdentifier<T>, newable: interfaces.Newable<T>, callback: ComponentCustomizationCallback): void {
    container.bind<T>(serviceIdentifier).to(newable).inSingletonScope().onActivation(createWrapWithLoggerActivator(configuration, serviceIdentifier, callback));
}

export function createWrapWithLoggerActivator<T extends object>(configuration: MethodsCalledLoggerConfiguration,
    serviceIdentifier: interfaces.ServiceIdentifier<T>,
    callback?: ComponentCustomizationCallback): (context: interfaces.Context, injectable: T) => T {
    return (_context: interfaces.Context, injectable: T) => {
        (<IHasContainerName>injectable).__containerName = configuration.containerName;
        const objectWithLogging = wrapWithLogging(configuration, injectable, `${configuration.containerName}.${getName(serviceIdentifier)}`);
        const possibleOverwrittenComponent = isDefined(callback)
            ? callback(serviceIdentifier, objectWithLogging, identifier => _context.container.get(identifier))
            : objectWithLogging;
        if (objectWithLogging === possibleOverwrittenComponent) {
            return objectWithLogging;
        } else {
            logger.log(`Dependency Injection component customization: for interface ${serviceIdentifier.toString()} replaced ${objectWithLogging} with ${possibleOverwrittenComponent}`);
            return <T>wrapWithLogging(configuration, possibleOverwrittenComponent, `${configuration.containerName}.${getName<T>(serviceIdentifier)}_Override`);
        }
    };
}

const prefixLength = 'Symbol('.length;
const postfixLength = ')'.length;
function getName<T extends object>(serviceIdentifier: string | symbol | interfaces.Newable<T> | interfaces.Abstract<T>) {
    if (typeof serviceIdentifier === 'symbol') {
        return serviceIdentifier.toString().slice(prefixLength, -postfixLength);
    } else {
        return printTopLevelObjectDescription(serviceIdentifier);
    }
}

function wrapWithLogging<T extends object>(configuration: MethodsCalledLoggerConfiguration,
    object: T, objectName: string) {
    return new MethodsCalledLogger<T>(configuration, object, objectName).wrapped();
}
