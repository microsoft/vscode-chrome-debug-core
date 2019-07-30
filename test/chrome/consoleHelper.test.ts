/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import { Protocol as Crdp } from 'devtools-protocol';

import * as testUtils from '../testUtils';
import * as ConsoleHelper from '../../src/chrome/consoleHelper';

suite('ConsoleHelper', () => {
    setup(() => {
        testUtils.setupUnhandledRejectionListener();
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();
    });

    /**
     * Test helper valid when the message consists only of strings that will be collapsed to one string
     */
    function doAssertForString(params: Crdp.Runtime.ConsoleAPICalledEvent, expectedText: string, expectedIsError = false): void {
        const result = ConsoleHelper.formatConsoleArguments(params.type, params.args, params.stackTrace);

        // Strings are collapsed to one string
        assert.equal(result.args.length, 1);
        assert.equal(result.args[0].type, 'string');

        assert.equal(result.args[0].value, expectedText);
        assert.equal(result.isError, expectedIsError);
    }

    suite('console.log()', () => {
        test('simple log', () => {
            doAssertForString(Runtime.makeLog('Hello'), 'Hello');
            doAssertForString(Runtime.makeLog('Hello', 123, 'world!'), 'Hello 123 world!');
        });

        test('basic format specifiers', () => {
            doAssertForString(Runtime.makeLog('%s, %d', 'test', 123), 'test, 123');
        });

        test('numeric format specifiers correctly', () => {
            doAssertForString(Runtime.makeLog('%d %i %f', 1.9, 324, 9.4), '1 324 9.4');
            doAssertForString(Runtime.makeLog('%d %i %f', -19, -32.5, -9.4), '-19 -33 -9.4');
            doAssertForString(Runtime.makeLog('%d %i %f', 'not', 'a', 'number'), 'NaN NaN NaN');
        });

        test('unmatched format specifiers', () => {
            doAssertForString(Runtime.makeLog('%s %s %s', 'test'), 'test %s %s');
            doAssertForString(Runtime.makeLog('%s %s end', 'test1', 'test2', 'test3'), 'test1 test2 end test3');
        });

        test('null/undefined cases', () => {
            doAssertForString(Runtime.makeLog('%s %s %s', null, undefined, 'test'), 'null undefined test');
            doAssertForString(Runtime.makeLog('test', null, undefined), 'test null undefined');
        });

        test('handles %c patterns for color', () => {
            doAssertForString(Runtime.makeLog('foo %cbar', 'color: red'), 'foo \x1b[0;91mbar');
        });

        test('handles empty %c patterns to reset color', () => {
            doAssertForString(Runtime.makeLog('%cfoo %cbar', 'color: red', 'color:'), '\x1b[0;91mfoo \x1b[0mbar');
        });

        test('handles %c patterns with font-weight', () => {
            doAssertForString(Runtime.makeLog('foo %cbar', 'font-weight: bold'), 'foo \x1b[0;1mbar');
        });

        test('handles %c patterns with background', () => {
          doAssertForString(Runtime.makeLog('foo %cbar', 'background: red'), 'foo \x1b[0;101mbar');
        });

        test('handles %c patterns with text-decoration', () => {
          doAssertForString(Runtime.makeLog('foo %cbar', 'text-decoration: underline'), 'foo \x1b[0;4mbar');
        });

        test('handles %c patterns with multiple attributes', () => {
          doAssertForString(Runtime.makeLog('foo %cbar', 'color: red; background: blue; font-weight: bold; text-decoration: underline'), 'foo \x1b[0;91;104;1;4mbar');
        });

        test('starts with non-string', () => {
            doAssertForString(Runtime.makeLog(1, 2, 3), '1 2 3');
        });

        test('%O text types', () => {
            doAssertForString(Runtime.makeLog('foo %O bar %O etc %O more', 'test', 1, null, undefined, NaN), 'foo test bar 1 etc null more undefined NaN');
        });

        test('empty strings', () => {
            doAssertForString(Runtime.makeLog(''), '');
        });

        test('string and object', () => {
            const result = ConsoleHelper.formatConsoleArguments('log', Runtime.makeArgs('foo', '$obj', 'bar'));
            assert.equal(result.isError, false);
            assert.equal(result.args.length, 3);
            assert.equal(result.args[0].value, 'foo');
            assert.equal(result.args[1].type, 'object');
            assert.equal(result.args[2].value, 'bar');
        });

        test('formatted strings and object', () => {
            const result = ConsoleHelper.formatConsoleArguments('log', Runtime.makeArgs('foo %d', 1, '$obj'));
            assert.equal(result.isError, false);
            assert.equal(result.args.length, 2);
            assert.equal(result.args[0].value, 'foo 1');
            assert.equal(result.args[1].type, 'object');
        });

        test('object formatted as num', () => {
            const result = ConsoleHelper.formatConsoleArguments('log', Runtime.makeArgs('foo %d', '$obj'));
            assert.equal(result.isError, false);
            assert.equal(result.args.length, 1);
            assert.equal(result.args[0].value, 'foo NaN');
        });

        test('object formatted as string', () => {
            const result = ConsoleHelper.formatConsoleArguments('log', Runtime.makeArgs('foo %s', '$obj'));
            assert.equal(result.isError, false);
            assert.equal(result.args.length, 1);
            assert.equal(result.args[0].value, 'foo Object');
        });

        test('unimplemented console method', () => {
            assert.equal(ConsoleHelper.formatConsoleArguments('table', Runtime.makeArgs('foo')), null);
        });

        test('%O with object', () => {
            const result = ConsoleHelper.formatConsoleArguments('log', Runtime.makeArgs('foo %O bar %O test', '$obj', '$obj'));
            assert.equal(result.isError, false);
            assert.equal(result.args.length, 5);
            assert.equal(result.args[0].value, 'foo ');
            assert.equal(result.args[1].type, 'object');
            assert.equal(result.args[2].value, ' bar ');
            assert.equal(result.args[3].type, 'object');
            assert.equal(result.args[4].value, ' test');
        });

        test('text params recombined after object arg', () => {
            const result = ConsoleHelper.formatConsoleArguments('log', Runtime.makeArgs('foo', '$obj', 'bar', 'test', '$obj', 'bar2', 'test2'));
            assert.equal(result.isError, false);
            assert.equal(result.args.length, 5);
            assert.equal(result.args[0].value, 'foo');
            assert.equal(result.args[1].type, 'object');
            assert.equal(result.args[2].value, 'bar test');
            assert.equal(result.args[3].type, 'object');
            assert.equal(result.args[4].value, 'bar2 test2');
        });
    });

    suite('console.assert()', () => {
        test(`Prints params and doesn't resolve format specifiers`, () => {
            doAssertForString(Runtime.makeAssert('Fail %s 123', 456), 'Assertion failed: Fail %s 123 456\n    at myFn (/script/a.js:5:1)', true);
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
    function makeMockMessage(type: string, args: (string | number | null | undefined)[], overrideProps?: any): Crdp.Runtime.ConsoleAPICalledEvent {
        const message: Crdp.Runtime.ConsoleAPICalledEvent = <any>{
            type,
            executionContextId: 2,
            timestamp: Date.now(),
            args: makeArgs(...args)
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

    /**
     * Returns a mock ConsoleAPICalledEvent with the given argument values.
     * You can pass '$obj' to get an object.
     */
    export function makeLog(...args: (string | number | null | undefined)[]): Crdp.Runtime.ConsoleAPICalledEvent {
        const msg = makeMockMessage('log', args);
        return msg;
    }

    export function makeArgs(...args: (string | number | null | undefined)[]): Crdp.Runtime.RemoteObject[] {
        return args.map(arg => {
            if (arg === '$obj') {
                return <Crdp.Runtime.RemoteObject>{
                    value: undefined,
                    type: 'object',
                    description: 'Object',
                    objectId: '$obj',
                };
            }

            const remoteObj = { type: typeof arg, value: arg, description: '' + arg };
            if (arg === null) {
                (<any>remoteObj).subtype = 'null';
            }

            return remoteObj;
        });
    }

    export function makeAssert(...args: any[]): Crdp.Runtime.ConsoleAPICalledEvent {
        const fakeStackTrace: Crdp.Runtime.StackTrace = {
            callFrames: [{ url: '/script/a.js', lineNumber: 4, columnNumber: 1, scriptId: '1', functionName: 'myFn' }]
        };
        return makeMockMessage('assert', args, { level: 'error', stackTrace: fakeStackTrace });
    }

    export function makeNetworkLog(text: string, url: string): Crdp.Runtime.ConsoleAPICalledEvent {
        return makeMockMessage('log', [text], { source: 'network', url, level: 'error' });
    }
}
