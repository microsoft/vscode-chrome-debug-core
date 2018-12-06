/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ChromeDebugSession, logger, UrlPathTransformer, BaseSourceMapTransformer, telemetry } from '../../src/index';
import * as path from 'path';
import * as os from 'os';

import { TestDebugAdapter } from './testDebugAdapter';
import { OnlyProvideCustomLauncherExtensibilityPoints } from '../../src/chrome/extensibility/extensibilityPoints';
import { TestDebugeeLauncher } from './testDebugeeLauncher';

const EXTENSION_NAME = 'debugger-for-chrome';

// Start a ChromeDebugSession configured to only match 'page' targets, which are Chrome tabs.
// Cast because DebugSession is declared twice - in this repo's vscode-debugadapter, and that of -core... TODO
ChromeDebugSession.run(ChromeDebugSession.getSession(
    {
        adapter: TestDebugAdapter,
        extensionName: EXTENSION_NAME,
        extensibilityPoints: new OnlyProvideCustomLauncherExtensibilityPoints(TestDebugeeLauncher),
        logFilePath: path.resolve(os.tmpdir(), 'vscode-chrome-debug.txt'),
        // targetFilter: defaultTargetFilter,

        pathTransformer: UrlPathTransformer,
        sourceMapTransformer: BaseSourceMapTransformer,
    }));

/* tslint:disable:no-var-requires */
const debugAdapterVersion = require('../../../package.json').version;
logger.log(EXTENSION_NAME + ': ' + debugAdapterVersion);

/* __GDPR__FRAGMENT__
    "DebugCommonProperties" : {
        "Versions.DebugAdapter" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
    }
*/
telemetry.telemetry.addCustomGlobalProperty({ 'Versions.DebugAdapter': debugAdapterVersion });
