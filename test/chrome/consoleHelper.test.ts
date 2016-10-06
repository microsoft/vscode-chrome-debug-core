/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as assert from 'assert';

import * as testUtils from '../testUtils';
import * as ConsoleHelper from '../../src/chrome/consoleHelper';
import * as Chrome from '../../src/chrome/chromeDebugProtocol';

suite('ConsoleHelper', () => {
    setup(() => {
        testUtils.setupUnhandledRejectionListener();
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();
    });

    function doAssert(params: Crdp.Runtime.ConsoleAPICalledParams, expectedText: string, expectedIsError = false): void {
        assert.deepEqual(ConsoleHelper.formatConsoleMessage(params), { text: expectedText, isError: expectedIsError });
    }

    suite('console.log()', () => {
        test('simple log', () => {
            doAssert(Runtime.makeLog('Hello'), 'Hello');
            doAssert(Runtime.makeLog('Hello', 123, 'world!'), 'Hello 123 world!');
        });

        test('basic format specifiers', () => {
            doAssert(Runtime.makeLog('%s, %d', 'test', 123), 'test, 123');
        });

        test('numeric format specifiers correctly', () => {
            doAssert(Runtime.makeLog('%d %i %f', 1.9, 324, 9.4), '1 324 9.4');
            doAssert(Runtime.makeLog('%d %i %f', -19, -32.5, -9.4), '-19 -33 -9.4');
            doAssert(Runtime.makeLog('%d %i %f', 'not', 'a', 'number'), 'NaN NaN NaN');
        });

        test('unmatched format specifiers', () => {
            doAssert(Runtime.makeLog('%s %s %s', 'test'), 'test %s %s');
            doAssert(Runtime.makeLog('%s %s end', 'test1', 'test2', 'test3'), 'test1 test2 end test3');
        });

        test('null/undefined cases', () => {
            doAssert(Runtime.makeLog('%s %s %s', null, undefined, 'test'), 'null undefined test');
            doAssert(Runtime.makeLog('test', null, undefined), 'test null undefined');
        });

        test('network error - need Log domain');

        test('objects- waiting on Microsoft/vscode-node-debug#4');
    });

    suite('console.assert()', () => {
        test(`Prints params and doesn't resolve format specifiers`, () => {
            doAssert(Runtime.makeAssert('Fail %s 123', 456), 'Assertion failed: Fail %s 123 456\n-  myFn @/script/a.js:4', true);
        });
    });
});

/**
 * Build the Chrome notifications objects for various console APIs.
 */
namespace Runtime {
    /**
     * Make a mock message of any type.
     * @param type - The type of the message
     * @param params - The list of parameters passed to the log function
     * @param overrideProps - An object of props that the message should have. The rest are filled in with defaults.
     */
    function makeMockMessage(type: string, args: any[], overrideProps?: any): Crdp.Runtime.ConsoleAPICalledParams {
        const message: Crdp.Runtime.ConsoleAPICalledParams = {
            type,
            executionContextId: 2,
            timestamp: Date.now(),
            args: args.map(param => {
                const remoteObj = { type: typeof param, value: param, description: '' + param };
                if (param === null) {
                    (<any>remoteObj).subtype = 'null';
                }

                return remoteObj;
            })
        };

        if (overrideProps) {
            for (let propName in overrideProps) {
                if (overrideProps.hasOwnProperty(propName)) {
                    message[propName] = overrideProps[propName];
                }
            }
        }

        return message;
    }

    export function makeLog(...args: any[]): Crdp.Runtime.ConsoleAPICalledParams {
        return makeMockMessage('log', args);
    }

    export function makeAssert(...args: any[]): Crdp.Runtime.ConsoleAPICalledParams {
        const fakeStackTrace: Crdp.Runtime.StackTrace = {
            callFrames: [{ url: '/script/a.js', lineNumber: 4, columnNumber: 0, scriptId: '1', functionName: 'myFn' }]
        };
        return makeMockMessage('assert', args, { level: 'error', stackTrace: fakeStackTrace });
    }

    export function makeNetworkLog(text: string, url: string): Crdp.Runtime.ConsoleAPICalledParams {
        return makeMockMessage('log', [text], { source: 'network', url, level: 'error' });
    }
}
