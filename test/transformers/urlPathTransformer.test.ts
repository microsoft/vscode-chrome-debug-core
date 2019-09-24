/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import * as mockery from 'mockery';

import * as testUtils from '../testUtils';
import {UrlPathTransformer as _UrlPathTransformer } from '../../src/transformers/urlPathTransformer';
import * as chromeUtils from '../../src/chrome/chromeUtils';

import { Mock, MockBehavior, It, IMock, Times } from 'typemoq';

const MODULE_UNDER_TEST = '../../src/transformers/urlPathTransformer';
function createTransformer(): _UrlPathTransformer {
    return new (require(MODULE_UNDER_TEST).UrlPathTransformer)();
}

suite('UrlPathTransformer', () => {
    const TARGET_URL = 'http://mysite.com/scripts/script1.js';
    const CLIENT_PATH = testUtils.pathResolve('/projects/mysite/scripts/script1.js');

    let chromeUtilsMock: IMock<typeof chromeUtils>;
    let transformer: _UrlPathTransformer;

    setup(() => {
        testUtils.setupUnhandledRejectionListener();
        mockery.enable({ useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false });

        chromeUtilsMock = Mock.ofInstance(chromeUtils, MockBehavior.Strict);
        mockery.registerMock('../chrome/chromeUtils', chromeUtilsMock.object);

        transformer = createTransformer();
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();
        mockery.deregisterAll();
        mockery.disable();

        chromeUtilsMock.verifyAll();
    });

    suite('setBreakpoints()', () => {
        let SET_BP_ARGS;
        const EXPECTED_SET_BP_ARGS = { source: { path: TARGET_URL } };

        setup(() => {
            // This will be modified by the test, so restore it before each
            SET_BP_ARGS = { source: { path: CLIENT_PATH } };
        });

        test('resolves correctly when it can map the client script to the target script', async () => {
            chromeUtilsMock
                .setup(x => x.targetUrlToClientPath(It.isValue(TARGET_URL), It.isValue(undefined)))
                .returns(() => Promise.resolve(CLIENT_PATH)).verifiable();

            await transformer.scriptParsed(TARGET_URL);
            SET_BP_ARGS.source = transformer.setBreakpoints(SET_BP_ARGS.source);
            assert.deepEqual(SET_BP_ARGS, EXPECTED_SET_BP_ARGS);
        });

        test(`doesn't modify the args when it can't map the client script to the target script`, () => {
            const origArgs = JSON.parse(JSON.stringify(SET_BP_ARGS));
            SET_BP_ARGS.source = transformer.setBreakpoints(SET_BP_ARGS.source);
            assert.deepEqual(SET_BP_ARGS, origArgs);
        });

        test(`uses path as-is when it's a URL`, () => {
            const args = <any>{ source: { path: TARGET_URL } };
            transformer.setBreakpoints(args);
            assert.deepEqual(args, EXPECTED_SET_BP_ARGS);
        });
    });

    suite('scriptParsed', () => {
        test('returns the client path when the file can be mapped', async () => {
            chromeUtilsMock
                .setup(x => x.targetUrlToClientPath(It.isValue(TARGET_URL), It.isValue(undefined)))
                .returns(() => Promise.resolve(CLIENT_PATH)).verifiable();

            assert.equal(await transformer.scriptParsed(TARGET_URL), CLIENT_PATH);
        });

        test(`returns the given path when the file can't be mapped`, async () => {
            chromeUtilsMock
                .setup(x => x.targetUrlToClientPath(It.isValue(TARGET_URL), It.isValue(undefined)))
                .returns(() => Promise.resolve('')).verifiable();

            chromeUtilsMock
                .setup(x => x.EVAL_NAME_PREFIX)
                .returns(() => 'VM').verifiable();

            assert.equal(await transformer.scriptParsed(TARGET_URL), TARGET_URL);
        });

        test('ok with uncanonicalized paths', async () => {
            chromeUtilsMock
                .setup(x => x.targetUrlToClientPath(It.isValue(TARGET_URL + '?queryparam'), It.isValue(undefined)))
                .returns(() => Promise.resolve(CLIENT_PATH)).verifiable();

            assert.equal(await transformer.scriptParsed(TARGET_URL + '?queryparam'), CLIENT_PATH);
            assert.equal(transformer.getClientPathFromTargetPath(TARGET_URL + '?queryparam'), CLIENT_PATH);
            assert.equal(transformer.getTargetPathFromClientPath(CLIENT_PATH), TARGET_URL + '?queryparam');
        });
    });

    suite('stackTraceResponse()', () => {
        const RUNTIME_LOCATIONS = [
            { line: 2, column: 3 },
            { line: 5, column: 6 },
            { line: 8, column: 9 }
        ];

        test('modifies the source path and clears sourceReference when the file can be mapped', async () => {
            chromeUtilsMock
                .setup(x => x.targetUrlToClientPath(It.isValue(TARGET_URL), It.isValue(undefined)))
                .returns(() => Promise.resolve(CLIENT_PATH)).verifiable(Times.atLeastOnce());

            const response = testUtils.getStackTraceResponseBody(TARGET_URL, RUNTIME_LOCATIONS, [1, 2, 3]);
            const expectedResponse = testUtils.getStackTraceResponseBody(CLIENT_PATH, RUNTIME_LOCATIONS);

            await transformer.stackTraceResponse(response);
            assert.deepEqual(response, expectedResponse);
        });

        test(`doesn't modify the source path or clear the sourceReference when the file can't be mapped`, () => {
            chromeUtilsMock
                .setup(x => x.targetUrlToClientPath(It.isValue(TARGET_URL), It.isValue(undefined)))
                .returns(() => Promise.resolve('')).verifiable(Times.atLeastOnce());

            const response = testUtils.getStackTraceResponseBody(TARGET_URL, RUNTIME_LOCATIONS, [1, 2, 3]);
            const expectedResponse = testUtils.getStackTraceResponseBody(TARGET_URL, RUNTIME_LOCATIONS, [1, 2, 3]);

            transformer.stackTraceResponse(response);
            assert.deepEqual(response, expectedResponse);
        });
    });
});