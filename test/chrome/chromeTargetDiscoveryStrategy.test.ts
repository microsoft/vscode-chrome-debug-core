/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as mockery from 'mockery';
import * as assert from 'assert';

import * as testUtils from '../testUtils';
import { ITargetDiscoveryStrategy } from '../../src/chrome/chromeConnection';

import { NullLogger } from '../../src/nullLogger';
import { NullTelemetryReporter } from '../../src/telemetry';
import { Version } from '../../src';

import * as _ctds from '../../src/chrome/chromeTargetDiscoveryStrategy';

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

        test('combines filters with a sensible precedence', () => {
            const targets = [
                // Skipped for missing `webSocketDebuggerUrl`.
                {
                    url: 'http://localhost/foo',
                    type: 'page',
                },
                // Skipped for violation of target filter.
                {
                    url: 'http://127.0.0.1/bar',
                    type: 'webview',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}`,
                },
                // Skipped for violation of URL filter.
                {
                    url: 'http://localhost-bad/bat',
                    type: 'page',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}`,
                },
                // Matches:
                {
                    url: 'http://localhost/bat',
                    type: 'page',
                    webSocketDebuggerUrl: `ws://${TARGET_ADDRESS}:${TARGET_PORT}`,
                }];
            registerTargetListContents(JSON.stringify(targets));

            return getChromeTargetDiscoveryStrategy().getTarget(
                TARGET_ADDRESS,
                TARGET_PORT,
                (target) => target.type === 'page',
                'http://localhost/*',
            ).then(target => {
                delete target.version;
                assert.deepEqual(target, targets[3]);
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

        test('ProtocolSchema return if the version is at least', () => {
            const schema0dot1 = new Version(0, 1);
            assert.ok(schema0dot1.isAtLeastVersion(0, 0));
            assert.ok(schema0dot1.isAtLeastVersion(0, 1));
            assert.ok(!schema0dot1.isAtLeastVersion(0, 2));
            assert.ok(!schema0dot1.isAtLeastVersion(1, 0));
            assert.ok(!schema0dot1.isAtLeastVersion(1, 1));
            assert.ok(!schema0dot1.isAtLeastVersion(1, 2));

            const schema0dot2 = new Version(0, 2);
            assert.ok(schema0dot2.isAtLeastVersion(0, 0));
            assert.ok(schema0dot2.isAtLeastVersion(0, 1));
            assert.ok(schema0dot2.isAtLeastVersion(0, 2));
            assert.ok(!schema0dot2.isAtLeastVersion(1, 0));
            assert.ok(!schema0dot2.isAtLeastVersion(1, 1));
            assert.ok(!schema0dot2.isAtLeastVersion(1, 2));

            const schema1dot0 = new Version(1, 0);
            assert.ok(schema1dot0.isAtLeastVersion(0, 0));
            assert.ok(schema1dot0.isAtLeastVersion(0, 1));
            assert.ok(schema1dot0.isAtLeastVersion(0, 2));
            assert.ok(schema1dot0.isAtLeastVersion(1, 0));
            assert.ok(!schema1dot0.isAtLeastVersion(1, 1));
            assert.ok(!schema1dot0.isAtLeastVersion(1, 2));
        });
    });

    suite('removeTitleProperty', () => {
        const removeTitleProperty: typeof _ctds.removeTitleProperty = require(MODULE_UNDER_TEST).removeTitleProperty;
        test('works', () => {
            assert.equal(removeTitleProperty('{ "title": "foo" }'), '{  }');
            assert.equal(removeTitleProperty('{ "url": "foo" }'), '{ "url": "foo" }');
            assert.equal(removeTitleProperty('{ "title": "foo", "url": "foo2" }'), '{  "url": "foo2" }');
        });
    });
});
