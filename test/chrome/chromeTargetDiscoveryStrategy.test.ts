/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as mockery from 'mockery';
import * as assert from 'assert';

import * as testUtils from '../testUtils';
import { ITargetDiscoveryStrategy } from '../../src/chrome/chromeConnection';

import { NullLogger } from '../../src/nullLogger';
import { NullTelemetryReporter } from '../../src/telemetry';

const MODULE_UNDER_TEST = '../../src/chrome/chromeTargetDiscoveryStrategy';
suite('ChromeTargetDiscoveryStrategy', () => {
    function getChromeTargetDiscoveryStrategy(): ITargetDiscoveryStrategy {
        const ChromeTargetDiscovery = require(MODULE_UNDER_TEST).ChromeTargetDiscovery;
        return new ChromeTargetDiscovery(new NullLogger(), new NullTelemetryReporter());
    }

    setup(() => {
        testUtils.setupUnhandledRejectionListener();
        mockery.enable({ useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false });
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();

        mockery.deregisterAll();
        mockery.disable();
    });

    const UTILS_PATH = '../utils';
    const TARGET_ADDRESS = '127.0.0.1';
    const TARGET_PORT = 9222;
    const TARGET_LIST_URL = `http://${TARGET_ADDRESS}:${TARGET_PORT}/json/list`;

    function registerTargetListContents(targetListJSON: string): void {
        testUtils.registerMockGetURL(UTILS_PATH, TARGET_LIST_URL, targetListJSON);
    }

    suite('getChromeTargetWebSocketURL()', () => {
        test('rejects promise if getting target list fails', () => {
            testUtils.registerMockGetURLFail(UTILS_PATH, TARGET_LIST_URL);

            return testUtils.assertPromiseRejected(
                getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT));
        });

        test('rejects promise if server responds with not JSON', () => {
            registerTargetListContents('this is not target list JSON');

            return testUtils.assertPromiseRejected(
                getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT));
        });

        test('rejects promise if server responds with JSON that is not an array', () => {
            registerTargetListContents('{ "prop1": "not an array" }');

            return testUtils.assertPromiseRejected(
                getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT));
        });

        test('respects the target filter', () => {
            const targets = [
                {
                    url: 'http://localhost/foo',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}/foo`
                },
                {
                    url: 'http://localhost/bar',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}/bar`
                }];
            registerTargetListContents(JSON.stringify(targets));

            return getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT, target => target.url === targets[1].url).then(target => {
                assert.deepEqual(target.webSocketDebuggerUrl, targets[1].webSocketDebuggerUrl);
            });
        });

        test('rejects promise if no matching targets', () => {
            const targets = [
                {
                    url: 'http://localhost/foo',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}`
                },
                {
                    url: 'http://localhost/bar',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}`
                }];
            registerTargetListContents(JSON.stringify(targets));

            return testUtils.assertPromiseRejected(
                getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT, undefined, 'blah.com'));
        });

        test('when no targets have webSocketDebuggerUrl, fails', () => {
            const targets = [
                {
                    url: 'http://localhost/foo',
                },
                {
                    url: 'http://localhost/bar',
                }];
            registerTargetListContents(JSON.stringify(targets));

            return testUtils.assertPromiseRejected(
                getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT, undefined, 'localhost/*'));
        });

        test('ignores targets with no webSocketDebuggerUrl (as when chrome devtools is attached)', () => {
            const targets = [
                {
                    url: 'http://localhost/foo',
                    webSocketDebuggerUrl: undefined,
                },
                {
                    url: 'http://localhost/bar',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}`
                }];
            registerTargetListContents(JSON.stringify(targets));

            return getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT, target => target.url === targets[1].url).then(target => {
                assert.deepEqual(target.webSocketDebuggerUrl, targets[1].webSocketDebuggerUrl);
            });
        });

        test('returns the first target when no target url pattern given', () => {
            const targets = [
                {
                    url: 'http://localhost/foo',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}/foo`
                },
                {
                    url: 'http://localhost/bar',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}/bar`
                }];
            registerTargetListContents(JSON.stringify(targets));

            return getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT).then(target => {
                assert.deepEqual(target.webSocketDebuggerUrl, targets[0].webSocketDebuggerUrl);
            });
        });

        test('modifies webSocketDebuggerUrl when target and web socket address differ', () => {
            const targets = [
                {
                    url: 'http://localhost/foo',
                    webSocketDebuggerUrl: 'ws://mismatched:1'
                },
                {
                    url: 'http://localhost/bar',
                    webSocketDebuggerUrl: 'ws://mismatched:2'
                }];
            registerTargetListContents(JSON.stringify(targets));

            const expectedWebSockerDebuggerUrl = `ws://${TARGET_ADDRESS}:${TARGET_PORT}`;
            return getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT).then(target => {
                assert.deepEqual(target.webSocketDebuggerUrl, expectedWebSockerDebuggerUrl);
            });
        });

        test('modifies webSocketDebuggerUrl when target and web socket port differ', () => {
            const targets = [
                {
                    url: 'http://localhost/foo',
                    webSocketDebuggerUrl: 'ws://localhost:4/foo'
                },
                {
                    url: 'http://localhost/bar',
                    webSocketDebuggerUrl: 'ws://localhost:17/bar'
                }];
            registerTargetListContents(JSON.stringify(targets));

            const expectedWebSockerDebuggerUrl = `ws://${TARGET_ADDRESS}:${TARGET_PORT}/foo`;
            return getChromeTargetDiscoveryStrategy().getTarget(TARGET_ADDRESS, TARGET_PORT).then(target => {
                assert.deepEqual(target.webSocketDebuggerUrl, expectedWebSockerDebuggerUrl);
            });
        });
    });
});