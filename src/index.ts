/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/** Normally, a consumer could require and use this and get the same instance. But if -core is npm linked, there may be two instances of file in play. */
import {logger} from 'vscode-debugadapter';

import * as chromeConnection from './chrome/chromeConnection';
import {ChromeDebugAdapter, LoadedSourceEventReason, ExtendedDebugProtocolVariable} from './chrome/chromeDebugAdapter';
import {ChromeDebugSession, IChromeDebugSessionOpts} from './chrome/chromeDebugSession';
import * as chromeTargetDiscoveryStrategy from './chrome/chromeTargetDiscoveryStrategy';
import * as chromeUtils from './chrome/chromeUtils';
import * as stoppedEvent from './chrome/stoppedEvent';

import {BasePathTransformer} from './transformers/basePathTransformer';
import {UrlPathTransformer} from './transformers/urlPathTransformer';
import {LineColTransformer} from './transformers/lineNumberTransformer';
import {BaseSourceMapTransformer} from './transformers/baseSourceMapTransformer';

export * from './debugAdapterInterfaces';

import * as utils from './utils';
import * as telemetry from './telemetry';
import * as variables from './chrome/variables';
import {NullLogger} from './nullLogger';

import Crdp from '../crdp/crdp';

export {
    chromeConnection,
    ChromeDebugAdapter,
    ChromeDebugSession,
    IChromeDebugSessionOpts,
    chromeTargetDiscoveryStrategy,
    chromeUtils,
    logger,
    stoppedEvent,
    LoadedSourceEventReason,
    ExtendedDebugProtocolVariable,

    UrlPathTransformer,
    BasePathTransformer,
    LineColTransformer,
    BaseSourceMapTransformer,

    utils,
    telemetry,
    variables,
    NullLogger,

    Crdp
}
