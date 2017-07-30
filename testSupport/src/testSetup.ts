/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';

import {ExtendedDebugClient} from './debugClient';

// ES6 default export...
const LoggingReporter = require('./loggingReporter');

let dc: ExtendedDebugClient;

let unhandledAdapterErrors: string[];
const origTest = test;
const checkLogTest = (title: string, testCallback?: any, testFn: Function = origTest): Mocha.ITest => {
    // Hack to always check logs after a test runs, can simplify after this issue:
    // https://github.com/mochajs/mocha/issues/1635
    if (!testCallback) {
        return origTest(title, testCallback);
    }

    function runTest(): Promise<any> {
        return new Promise((resolve, reject) => {
            const optionalCallback = e => {
                if (e) reject(e);
                else resolve();
            };

            const maybeP = testCallback(optionalCallback);
            if (maybeP && maybeP.then) {
                maybeP.then(resolve, reject);
            }
        });
    }

    return testFn(title, () => {
        return runTest()
            .then(() => {
                // If any unhandled errors were logged, then ensure the test fails
                if (unhandledAdapterErrors.length) {
                    const errStr = unhandledAdapterErrors.length === 1 ? unhandledAdapterErrors[0] :
                        JSON.stringify(unhandledAdapterErrors);
                    throw new Error(errStr);
                }
            });
    });
};
(<Mocha.ITestDefinition>checkLogTest).only = (expectation, assertion) => checkLogTest(expectation, assertion, origTest.only);
(<Mocha.ITestDefinition>checkLogTest).skip = test.skip;
test = (<any>checkLogTest);

function log(e: DebugProtocol.OutputEvent): void {
    // Skip telemetry events
    if (e.body.category === 'telemetry') return;

    const timestamp = new Date().toISOString().split(/[TZ]/)[1];
    const outputBody = e.body.output ? e.body.output.trim() : 'variablesReference: ' + e.body.variablesReference;
    const msg = ` ${timestamp} ${outputBody}`;
    LoggingReporter.logEE.emit('log', msg);

    if (msg.indexOf('********') >= 0) unhandledAdapterErrors.push(msg);
}

let patchLaunchArgsCb: Function;
function patchLaunchArgFns(): void {
    function patchLaunchArgs(launchArgs): void {
        launchArgs.trace = 'verbose';
        patchLaunchArgsCb(launchArgs);
    }

    const origLaunch = dc.launch;
    dc.launch = (launchArgs: any) => {
        patchLaunchArgs(launchArgs);
        return origLaunch.call(dc, launchArgs);
    };
}

export function setup(entryPoint: string, type: string, patchLaunchArgs?: Function, port?: number): Promise<ExtendedDebugClient> {
    unhandledAdapterErrors = [];
    patchLaunchArgsCb = patchLaunchArgs;
    dc = new ExtendedDebugClient('node', entryPoint, type);
    patchLaunchArgFns();
    dc.addListener('output', log);

    return dc.start(port)
        .then(() => dc);
}

export function teardown(): Promise<void> {
    dc.removeListener('output', log);
    return dc.stop();
}
