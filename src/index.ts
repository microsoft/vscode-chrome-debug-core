/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import 'reflect-metadata'; // We need to import this before any inject attempts to use it

/** Normally, a consumer could require and use this and get the same instance. But if -core is npm linked, there may be two instances of file in play. */
import { logger } from 'vscode-debugadapter';

import * as chromeConnection from './chrome/chromeConnection';
import { ChromeDebugLogic, LoadedSourceEventReason } from './chrome/chromeDebugAdapter';
import { ChromeDebugSession, IChromeDebugSessionOpts } from './chrome/chromeDebugSession';
import * as chromeTargetDiscoveryStrategy from './chrome/chromeTargetDiscoveryStrategy';
import * as chromeUtils from './chrome/chromeUtils';
import * as stoppedEvent from './chrome/stoppedEvent';
import { InternalSourceBreakpoint } from './chrome/internalSourceBreakpoint';
import { ErrorWithMessage } from './errors';

import { BasePathTransformer } from './transformers/basePathTransformer';
import { UrlPathTransformer } from './transformers/urlPathTransformer';
import { LineColTransformer } from './transformers/lineNumberTransformer';
import { BaseSourceMapTransformer } from './transformers/baseSourceMapTransformer';

export * from './debugAdapterInterfaces';

import * as utils from './utils';
import * as telemetry from './telemetry';
import * as variables from './chrome/variables';
import { NullLogger } from './nullLogger';
import * as executionTimingsReporter from './executionTimingsReporter';
import * as ChromeUtils from './chrome/chromeUtils';

import { Protocol as CDTP } from 'devtools-protocol';
import { TargetVersions } from './chrome/chromeTargetDiscoveryStrategy';
import { Version } from './chrome/utils/version';
import { parseResourceIdentifier, IResourceIdentifier } from './chrome/internal/sources/resourceIdentifier';
import { ChromeDebugAdapter } from './chrome/client/chromeDebugAdapter/chromeDebugAdapterV2';
import { IExtensibilityPoints, OnlyProvideCustomLauncherExtensibilityPoints } from './chrome/extensibility/extensibilityPoints';
import { IDebuggeeLauncher, ILaunchResult, IDebuggeeRunner, IDebuggeeInitializer, TerminatingReason } from './chrome/debugeeStartup/debugeeLauncher';
import { inject, injectable, postConstruct, interfaces, multiInject } from 'inversify';
import { ConnectedCDAConfiguration, IConnectedCDAConfiguration } from './chrome/client/chromeDebugAdapter/cdaConfiguration';
import { IInstallableComponent, ICommandHandlerDeclarer, IServiceComponent, CommandHandlerDeclaration, ICommandHandlerDeclaration } from './chrome/internal/features/components';
import { TYPES } from './chrome/dependencyInjection.ts/types';
import { IDebuggeeStateInspector } from './chrome/cdtpDebuggee/features/cdtpDebugeeStateInspector';
import { CDTPEventsEmitterDiagnosticsModule, CDTPEnableableDiagnosticsModule } from './chrome/cdtpDebuggee/infrastructure/cdtpDiagnosticsModule';
import { ISupportedDomains } from './chrome/internal/domains/supportedDomains';
import { ISession } from './chrome/client/session';
import { IPausedOverlayConfigurer } from './chrome/cdtpDebuggee/features/cdtpPausedOverlayConfigurer';
import { INetworkCacheConfigurer } from './chrome/cdtpDebuggee/features/cdtpNetworkCacheConfigurer';
import { IDebuggeeRuntimeVersionProvider, CDTPComponentsVersions } from './chrome/cdtpDebuggee/features/cdtpDebugeeRuntimeVersionProvider';
import { IBrowserNavigator } from './chrome/cdtpDebuggee/features/cdtpBrowserNavigator';
import { ISourcesRetriever } from './chrome/internal/sources/sourcesRetriever';
import { ISource } from './chrome/internal/sources/source';
import { ILoadedSourceTreeNode, SourceScriptRelationship, ILoadedSource } from './chrome/internal/sources/loadedSource';
import { IScript } from './chrome/internal/scripts/script';
import * as utilities from './chrome/collections/utilities';
import { CDTPDomainsEnabler } from './chrome/cdtpDebuggee/infrastructure/cdtpDomainsEnabler';
import { GetComponentByID, DependencyInjection } from './chrome/dependencyInjection.ts/di';
import { BaseCDAState } from './chrome/client/chromeDebugAdapter/baseCDAState';
import { UninitializedCDA } from './chrome/client/chromeDebugAdapter/uninitializedCDA';
import { SourceResolver } from './chrome/internal/sources/sourceResolver';
import { ICDTPDebuggeeExecutionEventsProvider, PausedEvent } from './chrome/cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { ScenarioType } from './chrome/client/chromeDebugAdapter/unconnectedCDA';
import { ILoggingConfiguration } from './chrome/internal/services/logging';
import { IFinishedStartingUpEventArguments, StepProgressEventsEmitter, ExecutionTimingsReporter } from './executionTimingsReporter';
import { ILogEventsProvider, ILogEntry } from './chrome/cdtpDebuggee/eventsProviders/cdtpLogEventsProvider';
import { IDOMInstrumentationBreakpointsSetter } from './chrome/cdtpDebuggee/features/cdtpDOMInstrumentationBreakpointsSetter';
import { IDebuggeePausedHandler } from './chrome/internal/features/debuggeePausedHandler';
import { IActionToTakeWhenPaused, NoActionIsNeededForThisPause, BasePauseShouldBeAutoResumed, BaseNotifyClientOfPause } from './chrome/internal/features/actionToTakeWhenPaused';
import { MakePropertyRequired } from './typeUtils';
import { printClassDescription } from './chrome/utils/printing';
import { IDebuggeeExecutionController } from './chrome/cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { CDTPScriptsRegistry } from './chrome/cdtpDebuggee/registries/cdtpScriptsRegistry';
import { EagerSourceMapTransformer } from './transformers/eagerSourceMapTransformer';
import { ISourceToClientConverter } from './chrome/client/sourceToClientConverter';
import { IEventsToClientReporter } from './chrome/client/eventsToClientReporter';
import { UserPageLaunchedError } from './chrome/client/clientLifecycleRequestsHandler';
import { SourceContents } from './chrome/internal/sources/sourceContents';
import { IExecutionContextEventsProvider } from './chrome/cdtpDebuggee/eventsProviders/cdtpExecutionContextEventsProvider';

export {
    chromeConnection,
    ChromeDebugLogic,
    ChromeDebugSession,
    IChromeDebugSessionOpts,
    chromeTargetDiscoveryStrategy,
    chromeUtils,
    logger,
    stoppedEvent,
    LoadedSourceEventReason,
    InternalSourceBreakpoint,
    ErrorWithMessage,

    ChromeDebugAdapter,
    IExtensibilityPoints,
    OnlyProvideCustomLauncherExtensibilityPoints,

    IDebuggeeLauncher,
    IDebuggeeInitializer,
    IDebuggeeRunner,
    ILaunchResult,
    ConnectedCDAConfiguration,
    inject,
    injectable,
    multiInject,
    UninitializedCDA,
    IInstallableComponent as IComponentWithAsyncInitialization,

    postConstruct,

    UrlPathTransformer,
    BasePathTransformer,
    LineColTransformer,
    BaseSourceMapTransformer,

    CDTPEventsEmitterDiagnosticsModule,
    utils,
    telemetry,
    variables,
    NullLogger,
    executionTimingsReporter,

    ISupportedDomains,
    IPausedOverlayConfigurer,

    Version,
    TargetVersions,

    INetworkCacheConfigurer,
    IDebuggeeRuntimeVersionProvider,

    parseResourceIdentifier,
    IBrowserNavigator,

    ISession,
    TYPES,

    IDebuggeeStateInspector,

    CDTP,

    interfaces,

    IResourceIdentifier,

    ISourcesRetriever,

    ISource,

    ILoadedSourceTreeNode,

    IScript,

    SourceScriptRelationship,

    SourceResolver,

    utilities,

    CDTPEnableableDiagnosticsModule,
    CDTPDomainsEnabler,
    GetComponentByID,

    BaseCDAState,

    IInstallableComponent,

    IServiceComponent,

    ICommandHandlerDeclarer,

    ICDTPDebuggeeExecutionEventsProvider,

    DependencyInjection,

    ScenarioType,

    ILoggingConfiguration,

    IFinishedStartingUpEventArguments,

    ChromeUtils,

    ILogEventsProvider,

    CDTPComponentsVersions,

    ILogEntry,

    IDOMInstrumentationBreakpointsSetter,

    IDebuggeePausedHandler,

    PausedEvent,

    IActionToTakeWhenPaused,

    NoActionIsNeededForThisPause,

    StepProgressEventsEmitter,

    IConnectedCDAConfiguration,

    MakePropertyRequired,

    printClassDescription,

    BasePauseShouldBeAutoResumed,

    IDebuggeeExecutionController,

    CDTPScriptsRegistry,

    EagerSourceMapTransformer,

    ISourceToClientConverter,

    ILoadedSource,

    BaseNotifyClientOfPause,

    IEventsToClientReporter,

    TerminatingReason,

    UserPageLaunchedError,

    ExecutionTimingsReporter,

    SourceContents,

    ICommandHandlerDeclaration,

    CommandHandlerDeclaration,
  
    IExecutionContextEventsProvider
};
