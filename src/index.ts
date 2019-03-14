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

import { Protocol as CDTP } from 'devtools-protocol';
import { TargetVersions } from './chrome/chromeTargetDiscoveryStrategy';
import { Version } from './chrome/utils/version';
import { parseResourceIdentifier, IResourceIdentifier } from './chrome/internal/sources/resourceIdentifier';
import { ChromeDebugAdapter } from './chrome/client/chromeDebugAdapter/chromeDebugAdapterV2';
import { IExtensibilityPoints, OnlyProvideCustomLauncherExtensibilityPoints } from './chrome/extensibility/extensibilityPoints';
import { IDebuggeeLauncher, ILaunchResult, IDebuggeeRunner } from './chrome/debugeeStartup/debugeeLauncher';
import { inject, injectable, postConstruct, interfaces } from 'inversify';
import { ConnectedCDAConfiguration } from './chrome/client/chromeDebugAdapter/cdaConfiguration';
import { IComponentWithAsyncInitialization } from './chrome/internal/features/components';
import { TYPES } from './chrome/dependencyInjection.ts/types';
import { IDebuggeeStateInspector } from './chrome/cdtpDebuggee/features/cdtpDebugeeStateInspector';
import { CDTPEventsEmitterDiagnosticsModule, CDTPEnableableDiagnosticsModule } from './chrome/cdtpDebuggee/infrastructure/cdtpDiagnosticsModule';
import { ICommunicator } from './chrome/communication/communicator';
import { ISupportedDomains } from './chrome/internal/domains/supportedDomains';
import { ISession } from './chrome/client/session';
import { IPausedOverlayConfigurer } from './chrome/cdtpDebuggee/features/cdtpPausedOverlayConfigurer';
import { INetworkCacheConfigurer } from './chrome/cdtpDebuggee/features/cdtpNetworkCacheConfigurer';
import { IDebuggeeRuntimeVersionProvider } from './chrome/cdtpDebuggee/features/cdtpDebugeeRuntimeVersionProvider';
import { IBrowserNavigator } from './chrome/cdtpDebuggee/features/cdtpBrowserNavigator';
import { ISourcesLogic } from './chrome/internal/sources/sourcesRetriever';
import { ISource } from './chrome/internal/sources/source';
import { ILoadedSourceTreeNode, SourceScriptRelationship } from './chrome/internal/sources/loadedSource';
import { IScript } from './chrome/internal/scripts/script';
import * as utilities from './chrome/collections/utilities';
import { CDTPDomainsEnabler } from './chrome/cdtpDebuggee/infrastructure/cdtpDomainsEnabler';
import { GetComponentByID } from './chrome/dependencyInjection.ts/di';

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
    IDebuggeeRunner,
    ILaunchResult,
    ConnectedCDAConfiguration,
    inject,
    injectable,
    IComponentWithAsyncInitialization as IComponent,

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
    IPausedOverlayConfigurer as IPausedOverlay,

    Version,
    TargetVersions,

    ICommunicator,

    INetworkCacheConfigurer as INetworkCacheConfiguration,
    IDebuggeeRuntimeVersionProvider as IDebuggeeVersionProvider,

    parseResourceIdentifier,
    IBrowserNavigator as IBrowserNavigation,

    ISession,
    TYPES,

    IDebuggeeStateInspector as IInspectDebuggeeState,

    CDTP,

    ISourcesLogic,

    interfaces,

    IResourceIdentifier,

    ISource,

    ILoadedSourceTreeNode,

    IScript,

    SourceScriptRelationship,

    utilities,

    CDTPEnableableDiagnosticsModule,
    CDTPDomainsEnabler,
    GetComponentByID,
};
