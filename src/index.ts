/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/** Normally, a consumer could require and use this and get the same instance. But if -core is npm linked, there may be two instances of file in play. */
import { logger } from 'vscode-debugadapter';

import * as chromeConnection from './chrome/chromeConnection';
import { ChromeDebugAdapter, LoadedSourceEventReason, IOnPausedResult } from './chrome/chromeDebugAdapter';
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

import { Protocol as Crdp } from 'devtools-protocol';
import { Version, TargetVersions } from './chrome/chromeTargetDiscoveryStrategy';
import { Breakpoints } from './chrome/breakpoints';
import { ScriptContainer } from './chrome/scripts';

export {
    chromeConnection,
    ChromeDebugAdapter,
    ChromeDebugSession,
    IOnPausedResult,
    IChromeDebugSessionOpts,
    chromeTargetDiscoveryStrategy,
    chromeUtils,
    logger,
    stoppedEvent,
    LoadedSourceEventReason,
    InternalSourceBreakpoint,
    ErrorWithMessage,

    UrlPathTransformer,
    BasePathTransformer,
    LineColTransformer,
    BaseSourceMapTransformer,

    utils,
    telemetry,
    variables,
    NullLogger,
    executionTimingsReporter,

    Version,
    TargetVersions,

    Crdp,

    Breakpoints,
    ScriptContainer
};
