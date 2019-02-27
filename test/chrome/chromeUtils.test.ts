/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as mockery from 'mockery';
import * as assert from 'assert';
import * as _path from 'path';
import * as _fs from 'fs';
import * as _utils from '../../src/utils';

import { ITarget } from '../../src/chrome/chromeConnection';
import * as testUtils from '../testUtils';

/** ChromeUtils without mocks - use for type only */
import * as _ChromeUtils from '../../src/chrome/chromeUtils';

let path: typeof _path;
let utils: typeof  _utils;
let fs: typeof  _fs;

const MODULE_UNDER_TEST = '../../src/chrome/chromeUtils';
suite('ChromeUtils', () => {
    function getChromeUtils(): typeof _ChromeUtils {
        return require(MODULE_UNDER_TEST);
    }

    setup(() => {
        testUtils.setupUnhandledRejectionListener();
        mockery.enable({ useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false });
        testUtils.registerWin32Mocks();
        testUtils.registerLocMocks();

        mockery.registerMock('fs', {
            statSync: () => { },
            stat: (path, cb) => cb()
        });

        // Get path with win32 mocks
        path = require('path');
        utils = require('../../src/utils');
        fs = require('fs');
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();

        mockery.deregisterAll();
        mockery.disable();
    });

    suite('targetUrlToClientPath()', () => {
        const TEST_CLIENT_PATH = 'c:\\site\\scripts\\a.js';
        const TEST_TARGET_LOCAL_URL = 'file:///' + TEST_CLIENT_PATH;
        const TEST_TARGET_HTTP_URL = 'http://site.com/page/scripts/a.js';
        const TEST_WEB_ROOT = 'c:\\site';
        const PATH_MAPPING = { '/': TEST_WEB_ROOT };

        test('an empty string is returned for a missing url', async () => {
            assert.equal(await getChromeUtils().targetUrlToClientPath('', PATH_MAPPING), '');
        });

        test('an empty string is returned when the pathMapping is missing', async () => {
            assert.equal(await getChromeUtils().targetUrlToClientPath(TEST_TARGET_HTTP_URL, null), '');
        });

        test('a url without a path returns an empty string', async () => {
            assert.equal(await getChromeUtils().targetUrlToClientPath('http://site.com', PATH_MAPPING), '');
        });

        test('multiple path parts are handled correctly', async () => {
            assert.equal(await getChromeUtils().targetUrlToClientPath('http://site.com/foo/bar.js', { '/': 'c:\\site1', '/foo': 'c:\\site2' }), 'c:\\site2\\bar.js');
        });

        test('it searches the disk for a path that exists, built from the url', async () => {
            const original = fs.stat;
            try {
                (fs.stat as any) = (aPath: string, cb) => {
                    if (aPath !== TEST_CLIENT_PATH) cb(new Error('Not found'));
                    cb(undefined, true);
                };

                assert.equal(await getChromeUtils().targetUrlToClientPath(TEST_TARGET_HTTP_URL, PATH_MAPPING), TEST_CLIENT_PATH);
            } finally {
                fs.stat = original;
            }
        });

        test(`returns an empty string when it can't resolve a url`, async () => {
            const original = fs.stat;
            try {
                (fs.stat as any) = (aPath: string) => {
                    throw new Error('Not found');
                };

                assert.equal(await getChromeUtils().targetUrlToClientPath(TEST_TARGET_HTTP_URL, PATH_MAPPING), '');
            } finally {
                fs.stat = original;
            }
        });

        test('file:/// urls are returned canonicalized', async () => {
            assert.equal(await getChromeUtils().targetUrlToClientPath(TEST_TARGET_LOCAL_URL, PATH_MAPPING), TEST_CLIENT_PATH);
        });

        test('uri encodings are fixed for file:/// paths', async () => {
            const clientPath = 'c:\\project\\path with spaces\\script.js';
            assert.equal(await getChromeUtils().targetUrlToClientPath('file:///' + encodeURI(clientPath), PATH_MAPPING), clientPath);
        });

        test('uri encodings are fixed in URLs', async () => {
            const pathSegment = 'path with spaces\\script.js';
            const url = 'http:\\' + encodeURIComponent(pathSegment);

            assert.equal(await getChromeUtils().targetUrlToClientPath(url, PATH_MAPPING), path.join(TEST_WEB_ROOT, pathSegment));
        });
    });

    suite('applyPathMappingsToTargetUrl()', () => {
        const TEST_CLIENT_PATH = 'c:\\site\\scripts\\a.js';
        const TEST_TARGET_HTTP_URL = 'http://site.com/page/scripts/a.js';
        const TEST_WEB_ROOT = 'c:\\site';

        const ROOT_MAPPING = { '/': TEST_WEB_ROOT };
        const PAGE_MAPPING = { '/page/': TEST_WEB_ROOT };
        const PARTIAL_PAGE_MAPPING = { '/page': TEST_WEB_ROOT };
        const FILE_MAPPING = { '/page.js': TEST_CLIENT_PATH };

        test('an empty string is returned for a missing url', () => {
            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl('', { }), '');
        });

        test('an empty string is returned for file: URLs', () => {
            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl('file:///Users/foo/bar.js', { }), '');
        });

        test('an empty string is returned for non-URLs', () => {
            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl('foo.js', { }), '');
        });

        test('a url without a path returns an empty string', () => {
            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl('http://site.com', { }), '');
        });

        test(`returns an empty string when it can't resolve a url`, () => {
            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl(TEST_TARGET_HTTP_URL, { '/foo': '/bar' }), '');
        });

        test('decodes uri-encoded characters', () => {
            const segmentWithSpaces = 'path with spaces';
            const escapedSegment = encodeURIComponent(segmentWithSpaces);
            const url = 'http://localhost/' + escapedSegment + '/script.js';

            assert.equal(
                getChromeUtils().applyPathMappingsToTargetUrl(url, ROOT_MAPPING),
                path.join(TEST_WEB_ROOT, segmentWithSpaces, 'script.js'));
        });

        test('matches mappings with uri-encoded characters', () => {
            const segmentWithSpaces = 'path with spaces';
            const escapedSegment = encodeURIComponent(segmentWithSpaces);
            const url = 'http://localhost/' + escapedSegment + '/script.js';

            assert.equal(
                getChromeUtils().applyPathMappingsToTargetUrl(url, { '/path%20with%20spaces/': TEST_WEB_ROOT }),
                path.join(TEST_WEB_ROOT, 'script.js'));
        });

        test('resolves webroot-style mapping', () => {
            assert.equal(
                getChromeUtils().applyPathMappingsToTargetUrl(TEST_TARGET_HTTP_URL, PAGE_MAPPING),
                TEST_CLIENT_PATH);
        });

        test('resolves webroot-style mapping without trailing slash', () => {
            assert.equal(
                getChromeUtils().applyPathMappingsToTargetUrl(TEST_TARGET_HTTP_URL, PARTIAL_PAGE_MAPPING),
                TEST_CLIENT_PATH);
        });

        test('resolves pathMapping for a particular file', () => {
            assert.equal(
                getChromeUtils().applyPathMappingsToTargetUrl('http://site.com/page.js', FILE_MAPPING),
                TEST_CLIENT_PATH);
        });

        test('return an empty string for url that has partially matching directory', () => {
            const url = 'http://site.com/page-alike/scripts/a.js';

            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl(url, PARTIAL_PAGE_MAPPING), '');
        });

        test('return an empty string for file matching pathMapped directory', () => {
            const url = 'http://site.com/page.js';

            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl(url, PARTIAL_PAGE_MAPPING), '');
        });

        test('matches longer patterns first', () => {
            const url = 'http://localhost/foo/bar';

            assert.equal(getChromeUtils().applyPathMappingsToTargetUrl(url, {
                '/': 'C:\\a',
                'foo': 'C:\\b'
            }), 'C:\\b\\bar');
        });
    });

    suite('remoteObjectToValue()', () => {
        const TEST_OBJ_ID = 'objectId';

        function testRemoteObjectToValue(obj: any, value: string, variableHandleRef?: string, stringify?: boolean): void {
            const Utilities = getChromeUtils();

            assert.deepEqual(Utilities.remoteObjectToValue(obj, stringify), { value, variableHandleRef });
        }

        test('bool', () => {
            testRemoteObjectToValue({ type: 'boolean', value: true }, 'true');
        });

        test('string', () => {
            let value = 'test string';
            testRemoteObjectToValue({ type: 'string', value }, `"${value}"`);
            testRemoteObjectToValue({ type: 'string', value }, `${value}`, undefined, /*stringify=*/false);

            value = 'NaN';
            testRemoteObjectToValue({ type: 'string', value }, `"${value}"`);

            value = '-Infinity';
            testRemoteObjectToValue({ type: 'string', value }, `"${value}"`);

            value = 'test string\r\nwith\nnewlines\n\n';
            const expValue = 'test string\\r\\nwith\\nnewlines\\n\\n';
            testRemoteObjectToValue({ type: 'string', value }, `"${expValue}"`);
        });

        test('number', () => {
            testRemoteObjectToValue({ type: 'number', description: '1' }, '1');
            testRemoteObjectToValue({ type: 'number', description: 'NaN' }, 'NaN');
            testRemoteObjectToValue({ type: 'number', description: 'Infinity' }, 'Infinity');
            testRemoteObjectToValue({ type: 'number', description: '-Infinity' }, '-Infinity');
        });

        test('array', () => {
            const description = 'Array[2]';
            testRemoteObjectToValue({ type: 'object', description, objectId: TEST_OBJ_ID }, description, TEST_OBJ_ID);
        });

        test('regexp', () => {
            const description = '/^asdf/g';
            testRemoteObjectToValue({ type: 'object', description, objectId: TEST_OBJ_ID }, description, TEST_OBJ_ID);
        });

        test('symbol', () => {
            const description = 'Symbol(s)';
            testRemoteObjectToValue({ type: 'symbol', description, objectId: TEST_OBJ_ID }, description);
        });

        test('function', () => {
            // ES6 arrow fn
            testRemoteObjectToValue({ type: 'function', description: '() => {\n  var x = 1;\n  var y = 1;\n}', objectId: TEST_OBJ_ID }, '() => { … }');

            // named fn
            testRemoteObjectToValue({ type: 'function', description: 'function asdf() {\n  var z = 5;\n}' }, 'function asdf() { … }');

            // anonymous fn
            testRemoteObjectToValue({ type: 'function', description: 'function () {\n  var z = 5;\n}' }, 'function () { … }');
        });

        test('undefined', () => {
            testRemoteObjectToValue({ type: 'undefined' }, 'undefined');
        });

        test('null', () => {
            testRemoteObjectToValue({ type: 'object', subtype: 'null' }, 'null');
        });
    });

    suite('getMatchingTargets()', () => {
        const chromeUtils = getChromeUtils();

        function makeTargets(...urls): ITarget[] {
            // Only the url prop is used
            return <any>urls.map(url => ({ url }));
        }

        test('returns exact match', () => {
            const targets = makeTargets('http://localhost/site/page', 'http://localhost/site');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'http://localhost/site'),
                [targets[1]]);
        });

        test('ignores the url protocol', () => {
            const targets = makeTargets('https://outlook.com', 'http://localhost');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'https://localhost'),
                [targets[1]]);
        });

        test('really ignores the url protocol', () => {
            const targets = makeTargets('https://outlook.com', 'http://localhost');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'localhost'),
                [targets[1]]);
        });

        test('is case-insensitive', () => {
            const targets = makeTargets('http://localhost/site', 'http://localhost');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'http://LOCALHOST'),
                [targets[1]]);
        });

        test('does not return substring fuzzy match as in pre 0.1.9', () => {
            const targets = makeTargets('http://localhost/site/page');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'http://localhost/site'),
                []);
        });

        test('respects one wildcard', () => {
            const targets = makeTargets('http://localhost/site/app', 'http://localhost/site/', 'http://localhost/');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'localhost/site/*'),
                [targets[0]]);
        });

        test('respects wildcards with query params', () => {
            const targets = makeTargets('http://localhost:3000/site/?blah=1', 'http://localhost:3000/site/?blah=2', 'http://localhost:3000/site/');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'localhost:3000/site/?*'),
                [targets[0], targets[1]]);
        });

        test('works with special chars', () => {
            const targets = makeTargets('http://localhost(foo)/[bar]/?baz', 'http://localhost(foo)/bar/?words', 'http://localhost/[bar]/?(somethingelse)');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'http://localhost(foo)/[bar]/?baz'),
                [targets[0]]);
        });

        test('works with special chars + wildcard', () => {
            const targets = makeTargets('http://localhost/[bar]/?(words)', 'http://localhost/bar/?words', 'http://localhost/[bar]/?(somethingelse)');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'http://localhost/[bar]/?(*)'),
                [targets[0], targets[2]]);
        });

        test('matches an ending slash', () => {
            const targets = makeTargets('http://localhost/', 'http://localhost');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, 'http://localhost'),
                targets);
        });

        test('works with file://', () => {
            const targets = makeTargets('file:///foo/bar', 'http://localhost');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, '/foo/bar'),
                [targets[0]]);
        });

        test('works with file:// + query params', () => {
            const targets = makeTargets('file:///foo/bar?a%3A%2F%2Fb', 'http://localhost');
            assert.deepEqual(
                chromeUtils.getMatchingTargets(targets, '/foo/bar?a://*'),
                [targets[0]]);
        });
    });

    suite('compareVariableNames', () => {
        const chromeUtils = getChromeUtils();

        test('numbers sorted numerically', () => {
            assert(chromeUtils.compareVariableNames('6', '1') > 0);
            assert(chromeUtils.compareVariableNames('2', '10') < 0);
        });

        test('string names before number names', () => {
            assert(chromeUtils.compareVariableNames('a', '1') < 0);
            assert(chromeUtils.compareVariableNames('16', 'b') > 0);
        });

        test('string names ordered correctly', () => {
            assert.equal(chromeUtils.compareVariableNames('a', 'b'), 'a'.localeCompare('b'));
            assert.equal(chromeUtils.compareVariableNames('xyz123', '890kjh'), 'xyz123'.localeCompare('890kjh'));
        });
    });

    suite('getEvaluateName', () => {
        const chromeUtils = getChromeUtils();

        test('Returns the name when there\'s no parent eval name', () => {
            assert.equal(chromeUtils.getEvaluateName('', 'abc'), 'abc');
        });

        test('Uses brackets for numbers', () => {
            assert.equal(chromeUtils.getEvaluateName('arr', '0'), 'arr[0]');
            assert.equal(chromeUtils.getEvaluateName('arr', '123'), 'arr[123]');
        });

        test('Uses dot notation when possible', () => {
            assert.equal(chromeUtils.getEvaluateName('obj', 'abc'), 'obj.abc');
            assert.equal(chromeUtils.getEvaluateName('obj', '$0'), 'obj.$0');
            assert.equal(chromeUtils.getEvaluateName('obj', '_a'), 'obj._a');
        });

        test('Uses brackets with strings for all other cases', () => {
            assert.equal(chromeUtils.getEvaluateName('obj', '0a'), 'obj["0a"]');
            assert.equal(chromeUtils.getEvaluateName('obj', '"'), 'obj["\\""]');
            assert.equal(chromeUtils.getEvaluateName('obj', ''), 'obj[""]');
            assert.equal(chromeUtils.getEvaluateName('obj', '1.2'), 'obj["1.2"]');
            assert.equal(chromeUtils.getEvaluateName('obj', 'a-b'), 'obj["a-b"]');
        });
    });

    suite('getUrlRegexForBreakOnLoad', () => {

        suite('when using case sensitive paths', () => {
            test('Works with a base file path', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('index.js'), '.*[\\\\\\/]index([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('index123.js'), '.*[\\\\\\/]index123([^A-z^0-9].*)?$');
            });

            test('Strips the nested file path', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\Subfolder\\index.js'), '.*[\\\\\\/]index([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\index123.ts'), '.*[\\\\\\/]index123([^A-z^0-9].*)?$');
            });

            test('Works case sensitive', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\Subfolder\\inDex.js'), '.*[\\\\\\/]inDex([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\INDex123.ts'), '.*[\\\\\\/]INDex123([^A-z^0-9].*)?$');
            });

            test('Escapes special characters', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\Subfolder\\inDex?abc.js'), '.*[\\\\\\/]inDex\\?abc([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\IN+De*x123.ts'), '.*[\\\\\\/]IN\\+De\\*x123([^A-z^0-9].*)?$');
            });
            });

        suite('when using case insensitive paths', () => {
            setup(() => {
                utils.setCaseSensitivePaths(false);
            });

            teardown(() => {
                utils.setCaseSensitivePaths(true);
            });

            test('Works with a base file path', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('index.js'), '.*[\\\\\\/][iI][nN][dD][eE][xX]([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('index123.js'), '.*[\\\\\\/][iI][nN][dD][eE][xX]123([^A-z^0-9].*)?$');
            });

            test('Strips the nested file path', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\Subfolder\\index.js'), '.*[\\\\\\/][iI][nN][dD][eE][xX]([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\index123.ts'), '.*[\\\\\\/][iI][nN][dD][eE][xX]123([^A-z^0-9].*)?$');
            });

            test('Works case sensitive', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\Subfolder\\inDex.js'), '.*[\\\\\\/][iI][nN][dD][eE][xX]([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\INDex123.ts'), '.*[\\\\\\/][iI][nN][dD][eE][xX]123([^A-z^0-9].*)?$');
            });

            test('Escapes special characters', () => {
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\Subfolder\\inDex?abc.js'), '.*[\\\\\\/][iI][nN][dD][eE][xX]\\?[aA][bB][cC]([^A-z^0-9].*)?$');
                assert.deepEqual(getChromeUtils().getUrlRegexForBreakOnLoad('C:\\Folder\\IN+De*x123.ts'), '.*[\\\\\\/][iI][nN]\\+[dD][eE]\\*[xX]123([^A-z^0-9].*)?$');
            });
            });
    });
});
