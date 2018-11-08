/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as mockery from 'mockery';
import * as assert from 'assert';

import * as testUtils from './testUtils';

/** Utils without mocks - use for type only */
import * as _Utils from '../src/utils';

const MODULE_UNDER_TEST = '../src/utils';
suite('Utils', () => {
    function getUtils(): typeof _Utils {
        return require(MODULE_UNDER_TEST);
    }

    setup(() => {
        testUtils.setupUnhandledRejectionListener();

        mockery.enable({ useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false });
        testUtils.registerWin32Mocks();
        testUtils.registerLocMocks();
        mockery.registerMock('fs', { statSync: () => { } });
        mockery.registerMock('http', {});
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();

        mockery.deregisterAll();
        mockery.disable();
    });

    suite('getPlatform()', () => {
        test('osx', () => {
            mockery.registerMock('os', { platform: () => 'darwin' });
            const Utils = getUtils();
            assert.equal(Utils.getPlatform(), Utils.Platform.OSX);
        });

        test('win', () => {
            const Utils = getUtils();
            assert.equal(Utils.getPlatform(), Utils.Platform.Windows);
        });

        test('linux', () => {
            mockery.registerMock('os', { platform: () => 'linux' });
            const Utils = getUtils();
            assert.equal(Utils.getPlatform(), Utils.Platform.Linux);
        });

        test('freebsd (default to Linux for anything unknown)', () => {
            mockery.registerMock('os', { platform: () => 'freebsd' });
            const Utils = getUtils();
            assert.equal(Utils.getPlatform(), Utils.Platform.Linux);
        });
    });

    suite('existsSync()', () => {
        test('it returns false when statSync throws', () => {
            const statSync = (aPath: string) => {
                if (aPath.indexOf('notfound') >= 0) throw new Error('Not found');
            };
            mockery.registerMock('fs', { statSync });

            const Utils = getUtils();
            assert.equal(Utils.existsSync('exists'), true);
            assert.equal(Utils.existsSync('thisfilenotfound'), false);
        });
    });

    suite('reversedArr()', () => {
        test('it does not modify the input array', () => {
            let arr = [2, 4, 6];
            getUtils().reversedArr(arr);
            assert.deepEqual(arr, [2, 4, 6]);

            arr = [1];
            getUtils().reversedArr(arr);
            assert.deepEqual(arr, [1]);
        });

        test('it reverses the array', () => {
            assert.deepEqual(getUtils().reversedArr([1, 3, 5, 7]), [7, 5, 3, 1]);
            assert.deepEqual(
                getUtils().reversedArr([-1, 'hello', null, undefined, [1, 2]]),
                [[1, 2], undefined, null, 'hello', -1]);
        });
    });

    suite('promiseTimeout()', () => {
        test('when given a promise it fails if the promise never resolves', () => {
            return getUtils().promiseTimeout(new Promise(() => { }), 5).then(
                () => testUtils.assertFail('This promise should fail'),
                e => { }
            );
        });

        test('when given a promise it succeeds if the promise resolves', () => {
            return getUtils().promiseTimeout(Promise.resolve('test'), 5).then(
                result => {
                    assert.equal(result, 'test');
                },
                e => testUtils.assertFail('This promise should pass')
            );
        });

        test('when not given a promise it resolves', () => {
            return getUtils().promiseTimeout(null, 5).then(
                null,
                () => testUtils.assertFail('This promise should pass')
            );
        });
    });

    suite('retryAsync()', () => {
        test('when the function passes, it resolves with the value', () => {
            return getUtils().retryAsync(() => Promise.resolve('pass'), /*timeoutMs=*/5).then(
                result => {
                    assert.equal(result, 'pass');
                },
                e => {
                    testUtils.assertFail('This should have passed');
                });
        });

        test('when the function fails, it rejects', () => {
            return getUtils().retryAsync(() => getUtils().errP('fail'), /*timeoutMs=*/5)
                .then(
                    () => testUtils.assertFail('This promise should fail'),
                    e => assert.equal(e.message, 'fail'));
        });
    });

    suite('canonicalizeUrl()', () => {
        function testCanUrl(inUrl: string, expectedUrl: string): void {
            const Utils = getUtils();
            assert.equal(Utils.canonicalizeUrl(inUrl), expectedUrl);
        }

        test('enforces path.sep slash', () => {
            testCanUrl('c:\\thing\\file.js', 'c:\\thing\\file.js');
            testCanUrl('c:/thing/file.js', 'c:\\thing\\file.js');
        });

        test('removes query params from url', () => {
            const cleanUrl = 'http://site.com/My/Cool/Site/script.js';
            const url = cleanUrl + '?stuff';
            testCanUrl(url, cleanUrl);
        });

        test('strips trailing slash', () => {
            testCanUrl('http://site.com/', 'http://site.com');
        });

        test('paths with different cases get canonicalized to the same string when case insensitive', () => {
            const Utils = getUtils();
            try {
                Utils.setCaseSensitivePaths(false);
                assert.equal(Utils.canonicalizeUrl('c:\\Users\\username\\source\\repos\\WebApplication77\\WebApplication77\\Scripts\\bootstrap.js'),
                    Utils.canonicalizeUrl('c:\\users\\username\\source\\repos\\WebApplication77\\WebApplication77\\Scripts\\bootstrap.js'));
            } finally {
                Utils.setCaseSensitivePaths(true);
            }
        });
    });

    suite('fileUrlToPath()', () => {
        function testFileUrlToPath(inUrl: string, expectedUrl: string): void {
            assert.equal(getUtils().fileUrlToPath(inUrl), expectedUrl);
        }

        test('removes file:///', () => {
            testFileUrlToPath('file:///c:/file.js', 'c:\\file.js');
        });

        test('unescape when doing url -> path', () => {
            testFileUrlToPath('file:///c:/path%20with%20spaces', 'c:\\path with spaces');
        });

        test('ensures local path starts with / on OSX', () => {
            mockery.registerMock('os', { platform: () => 'darwin' });
            testFileUrlToPath('file:///Users/scripts/app.js', '/Users/scripts/app.js');
        });

        test('force lowercase drive letter on Win to match VS Code', () => {
            // note default 'os' mock is win32
            testFileUrlToPath('file:///D:/FILE.js', 'd:\\FILE.js');
        });

        test('ignores non-file URLs', () => {
            const url = 'http://localhost/blah';
            testFileUrlToPath(url, url);
        });

        test('works for file urls that contain : elsewhere', () => {
            // Should remove query args?
            const expectedPath = '/Users/me/file?config={"a":"b"}';
            testFileUrlToPath('file://' + expectedPath, expectedPath);
        });
    });

    suite('forceForwardSlashes', () => {
        test('works for c:/... cases', () => {
            assert.equal(getUtils().forceForwardSlashes('C:\\foo\\bar'), 'C:/foo/bar');
            assert.equal(getUtils().forceForwardSlashes('C:\\'), 'C:/');
            assert.equal(getUtils().forceForwardSlashes('C:/foo\\bar'), 'C:/foo/bar');
        });

        test('works for relative paths', () => {
            assert.equal(getUtils().forceForwardSlashes('foo\\bar'), 'foo/bar');
            assert.equal(getUtils().forceForwardSlashes('foo\\bar/baz'), 'foo/bar/baz');
        });

        test('fixes escaped forward slashes', () => {
            assert.equal(getUtils().forceForwardSlashes('foo\\/bar'), 'foo/bar');
        });
    });

    suite('fixDriveLetterAndSlashes', () => {
        test('works for c:/... cases', () => {
            assert.equal(getUtils().fixDriveLetterAndSlashes('C:/path/stuff'), 'c:\\path\\stuff');
            assert.equal(getUtils().fixDriveLetterAndSlashes('c:/path\\stuff'), 'c:\\path\\stuff');
            assert.equal(getUtils().fixDriveLetterAndSlashes('C:\\path'), 'c:\\path');
            assert.equal(getUtils().fixDriveLetterAndSlashes('C:\\'), 'c:\\');
        });

        test('works for file:/// cases', () => {
            assert.equal(getUtils().fixDriveLetterAndSlashes('file:///C:/path/stuff'), 'file:///c:\\path\\stuff');
            assert.equal(getUtils().fixDriveLetterAndSlashes('file:///c:/path\\stuff'), 'file:///c:\\path\\stuff');
            assert.equal(getUtils().fixDriveLetterAndSlashes('file:///C:\\path'), 'file:///c:\\path');
            assert.equal(getUtils().fixDriveLetterAndSlashes('file:///C:\\'), 'file:///c:\\');
        });

        test('does not impact posix cases', () => {
            assert.equal(getUtils().fixDriveLetterAndSlashes('file:///a/b'), 'file:///a/b');
            assert.equal(getUtils().fixDriveLetterAndSlashes('/a/b'), '/a/b');
        });
    });

    suite('isURL', () => {
        function assertIsURL(url: string): void {
            assert(getUtils().isURL(url));
        }

        function assertNotURL(url: string): void {
            assert(!getUtils().isURL(url));
        }

        test('returns true for URLs', () => {
            assertIsURL('http://localhost');
            assertIsURL('http://mysite.com');
            assertIsURL('file:///c:/project/code.js');
            assertIsURL('webpack:///webpack/webpackthing');
            assertIsURL('https://a.b.c:123/asdf?fsda');
        });

        test('returns false for not-URLs', () => {
            assertNotURL('a');
            assertNotURL('/project/code.js');
            assertNotURL('c:/project/code.js');
            assertNotURL('abc123!@#');
            assertNotURL('');
            assertNotURL(null);
        });
    });

    suite('lstrip', () => {
        test('does what it says', () => {
            assert.equal(getUtils().lstrip('test', 'te'), 'st');
            assert.equal(getUtils().lstrip('asdf', ''), 'asdf');
            assert.equal(getUtils().lstrip('asdf', null), 'asdf');
            assert.equal(getUtils().lstrip('asdf', 'asdf'), '');
            assert.equal(getUtils().lstrip('asdf', '123'), 'asdf');
            assert.equal(getUtils().lstrip('asdf', 'sdf'), 'asdf');
        });
    });

    suite('pathToFileURL', () => {
        test('converts windows-style paths', () => {
            assert.equal(getUtils().pathToFileURL('c:\\code\\app.js'), 'file:///c:/code/app.js');
        });

        test('converts network path paths', () => {
            assert.equal(getUtils().pathToFileURL('\\\\foo bar\\something'), 'file:///foo%20bar/something');
            assert.equal(getUtils().pathToFileURL('\\\\localhost\\c$\\app.js'), 'file:///localhost/c$/app.js');
        });

        test('converts unix-style paths', () => {
            assert.equal(getUtils().pathToFileURL('/code/app.js'), 'file:///code/app.js');
        });

        test('encodes as URI and forces forwards slash', () => {
            assert.equal(getUtils().pathToFileURL('c:\\path with spaces\\blah.js'), 'file:///c:/path%20with%20spaces/blah.js');
        });

        test('normalizes', () => {
            assert.equal(getUtils().pathToFileURL('c:\\path with spaces\\.\\foo\\..\\blah.js', true), 'file:///c:/path%20with%20spaces/blah.js');
        });
    });

    suite('pathToRegex - case sensitive', () => {
        function testPathToRegex(aPath: string, expectedRegex: string): void {
            assert.equal(getUtils().pathToRegex(aPath), expectedRegex);
        }

        test('works for a simple posix path', () => {
            testPathToRegex('/a/b.js', '\\/a\\/b\\.js|file:\\/\\/\\/a\\/b\\.js');
        });

        test('works for a simple windows path', () => {
            testPathToRegex('c:\\a\\b.js', '[Cc]:\\\\a\\\\b\\.js|file:\\/\\/\\/[Cc]:\\/a\\/b\\.js');
        });

        test('works for a url', () => {
            testPathToRegex('http://localhost:8080/a/b.js', 'http:\\/\\/localhost:8080\\/a\\/b\\.js');
        });

        test('works for a posix file url', () => {
            testPathToRegex('file:///a/b.js', 'file:\\/\\/\\/a\\/b\\.js');
        });

        test('escapes the drive letter for a windows file url', () => {
            testPathToRegex('file:///c:\\a\\b.js', 'file:\\/\\/\\/[Cc]:\\\\a\\\\b\\.js');
        });

        test('space in path', () => {
            testPathToRegex('/a/space path.js', '\\/a\\/space path\\.js|file:\\/\\/\\/a\\/space%20path\\.js');
        });
    });

    suite('pathToRegex - case insensitive', () => {
        function testPathToRegex(aPath: string, expectedRegex: string): void {
            const utils = getUtils();
            try {
                utils.setCaseSensitivePaths(false);
                assert.equal(utils.pathToRegex(aPath), expectedRegex);
            } finally {
                utils.setCaseSensitivePaths(true);
            }
        }

        test('works for a simple posix path', () => {
            testPathToRegex('/a/b.js', '\\/[aA]\\/[bB]\\.[jJ][sS]|[fF][iI][lL][eE]:\\/\\/\\/[aA]\\/[bB]\\.[jJ][sS]');
        });

        test('works for a simple windows path', () => {
            testPathToRegex('c:\\a\\b.js', '[cC]:\\\\[aA]\\\\[bB]\\.[jJ][sS]|[fF][iI][lL][eE]:\\/\\/\\/[cC]:\\/[aA]\\/[bB]\\.[jJ][sS]');
        });

        test('works for a url', () => {
            testPathToRegex('http://localhost:8080/a/b.js', '[hH][tT][tT][pP]:\\/\\/[lL][oO][cC][aA][lL][hH][oO][sS][tT]:8080\\/[aA]\\/[bB]\\.[jJ][sS]');
        });

        test('works for a posix file url', () => {
            testPathToRegex('file:///a/b.js', 'file:\\/\\/\\/[aA]\\/[bB]\\.[jJ][sS]');
        });

        test('escapes the drive letter for a windows file url', () => {
            testPathToRegex('file:///c:\\a\\b.js', 'file:\\/\\/\\/[cC]:\\\\[aA]\\\\[bB]\\.[jJ][sS]');
        });
    });

    suite('pathGlobToBlackboxedRegex', () => {
        function testPathGlobToBlackboxedRegex(glob: string, expected: string): void {
            assert.equal(getUtils().pathGlobToBlackboxedRegex(glob), expected);
        }

        test('universal', () => {
            testPathGlobToBlackboxedRegex('*', '.*');
        });

        test('url', () => {
            testPathGlobToBlackboxedRegex('http://localhost:8080/node_modules/**/*.js', 'http:[/\\\\][/\\\\]localhost:8080[/\\\\]node_modules[/\\\\](.*[\/\\\\])?.*\\.js');
        });

        test('path segment', () => {
            testPathGlobToBlackboxedRegex('node_modules', 'node_modules');
        });

        test('file extension', () => {
            testPathGlobToBlackboxedRegex('*.foo.bar', '.*\\.foo\\.bar');
        });

        test('escapes special chars except asterisk', () => {
            testPathGlobToBlackboxedRegex('*.+[(', '.*\\.\\+\\[\\(');
        });

        test('slash-agnostic', () => {
            testPathGlobToBlackboxedRegex('a/b\\c', 'a[/\\\\]b[/\\\\]c');
        });

        test('**/ is optional but not too optional', () => {
            // matches ^foo.js
            let r = new RegExp('^' + getUtils().pathGlobToBlackboxedRegex('**/foo.js'));
            assert(!!r.test('foo.js'));

            // but not something that ends in foo.js
            assert(!r.test('barfoo.js'));
        });

        test('.* in glob', () => {
            testPathGlobToBlackboxedRegex('foo.*.bar', 'foo\\..*\\.bar');
        });
    });

    suite('makeRegexNotMatchPath/makeRegexMatchPath', () => {
        function testMakeRegexNotMatchPath(regex: RegExp, noMatchPath: string, matchPath?: string): void {
            const noMatchResult = getUtils().makeRegexNotMatchPath(regex, noMatchPath);
            assert(!noMatchResult.test(noMatchPath), `shouldn't match noMatchPath`);
            if (matchPath) {
                assert(noMatchResult.test(matchPath), `should still match matchPath`);
            }

            // Reverse it, and assert that it now matches again
            const matchResult = getUtils().makeRegexMatchPath(noMatchResult, noMatchPath);
            assert(matchResult.test(noMatchPath), 'should now match noMatchPath');
            if (matchPath) {
                assert(matchResult.test(matchPath), 'should now match matchPath');
            }
        }

        test('simple path', () => {
            testMakeRegexNotMatchPath(/\/foo/, '/foo');
        });

        test('still matches other path', () => {
            testMakeRegexNotMatchPath(/\/[a-z]{3}/, '/foo', '/bar');
        });

        test('longer path', () => {
            testMakeRegexNotMatchPath(/foo\/bar\/some\-thing\d\.js/, '/foo/bar/some-thing1.js', '/foo/bar/some-thing2.js');
        });

        test(`case insensitive`, () => {
            testMakeRegexNotMatchPath(/\/FOO/i, '/foo');
        });

        test('path segment', () => {
            testMakeRegexNotMatchPath(/bar\d/, '/foo/bar1', '/foo/bar2');
        });
    });

    suite('firstLine', () => {
        test('gets first line', () => {
            [
                ['foo\nbar', 'foo'],
                ['\nbar', ''],
                ['foo', 'foo'],
                ['', ''],
                [undefined, '']
            ].forEach(([text, firstLine]) => {
                assert.equal(getUtils().firstLine(text), firstLine);
            });
        });
    });

    suite('fileUrlToNetworkPath', () => {
        test('true for network paths', () => {
            [
                ['file:///foo%20bar/something', '\\\\foo bar\\something'],
                ['file:///localhost/c$/app.js', '\\\\localhost\\c$\\app.js']
            ].forEach(([testPath, expected]) => assert.equal(getUtils().fileUrlToNetworkPath(testPath), expected));
        });
    });
});
