/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import * as mockery from 'mockery';
import * as os from 'os';
import * as path from 'path';

import * as testUtils from '../testUtils';

import { getComputedSourceRoot, applySourceMapPathOverrides, resolveMapPath, getFullSourceEntry } from '../../src/sourceMaps/sourceMapUtils';

/** sourceMapUtils without mocks - use for type only */
import * as _SourceMapUtils from '../../src/sourceMaps/sourceMapUtils';
import { utils } from '../../src';
const MODULE_UNDER_TEST = '../../src/sourceMaps/sourceMapUtils';

suite('SourceMapUtils', () => {
    function getSourceMapUtils(): typeof _SourceMapUtils {
        return require(MODULE_UNDER_TEST);
    }

    setup(() => {
        testUtils.setupUnhandledRejectionListener();

        mockery.enable({ warnOnReplace: false, useCleanCache: true, warnOnUnregistered: false });
        testUtils.registerWin32Mocks();
        testUtils.registerLocMocks();
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();
        mockery.deregisterAll();
        mockery.disable();
    });

    suite('getComputedSourceRoot()', () => {
        const GEN_PATH = testUtils.pathResolve('/project/webroot/code/script.js');
        const GEN_URL = 'http://localhost:8080/code/script.js';
        const ABS_SOURCEROOT = testUtils.pathResolve('/project/src');
        const WEBROOT = testUtils.pathResolve('/project/webroot');
        const PATH_MAPPING = { '/': WEBROOT };

        test('handles file:/// sourceRoot', () => {
            assert.equal(
                getComputedSourceRoot('file:///' + ABS_SOURCEROOT, GEN_PATH, PATH_MAPPING),
                ABS_SOURCEROOT);
        });

        test('handles /src style sourceRoot', () => {
            assert.equal(
                getComputedSourceRoot('/src', GEN_PATH, PATH_MAPPING),
                testUtils.pathResolve('/project/webroot/src'));
        });

        test('handles /src style without matching pathMapping', () => {
            assert.equal(
                getComputedSourceRoot('/foo/bar', GEN_PATH, { }),
                '/foo/bar');
        });

        test('handles c:/src style without matching pathMapping', () => {
            assert.equal(
                getComputedSourceRoot('c:\\foo\\bar', GEN_PATH, { }),
                'c:\\foo\\bar');
        });

        test('handles ../../src style sourceRoot', () => {
            assert.equal(
                getComputedSourceRoot('../../src', GEN_PATH, PATH_MAPPING),
                ABS_SOURCEROOT);
        });

        test('handles src style sourceRoot', () => {
            assert.equal(
                getComputedSourceRoot('src', GEN_PATH, PATH_MAPPING),
                testUtils.pathResolve('/project/webroot/code/src'));
        });

        test('handles runtime script not on disk', () => {
            assert.equal(
                getComputedSourceRoot('../src', GEN_URL, PATH_MAPPING),
                testUtils.pathResolve('/project/webroot/src'));
        });

        test('when no sourceRoot specified and runtime script is on disk, uses the runtime script dirname', () => {
            assert.equal(
                getComputedSourceRoot('', GEN_PATH, PATH_MAPPING),
                testUtils.pathResolve('/project/webroot/code'));
        });

        test('when no sourceRoot specified and runtime script is not on disk, uses the runtime script dirname', () => {
            assert.equal(
                getComputedSourceRoot('', GEN_URL, PATH_MAPPING),
                testUtils.pathResolve('/project/webroot/code'));
        });

        test('no crash on debugadapter:// urls', () => {
            assert.equal(
                getComputedSourceRoot('', 'eval://123', PATH_MAPPING),
                testUtils.pathResolve(WEBROOT));
        });
    });

    suite('applySourceMapPathOverrides', () => {
        test('removes a matching webpack prefix', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('webpack:///src/app.js', { 'webpack:///*': testUtils.pathResolve('/project/*') }),
                testUtils.pathResolve('/project/src/app.js'));
        });

        function normalized(filePath: string) {
            return utils.canonicalizeUrl(path.join(filePath.toLowerCase())).replace(new RegExp(/\\/g), '/');
        }

        const projectFolder = testUtils.pathResolve('/project');

        test('Adds ClientApp to the path in VisualStudio as a fallback to the ASP.NET Angular Template in 2.1', () => {
            mockery.resetCache();
            const tsFileCanonicalized = normalized(`${projectFolder}/ClientApp/src/app/counter/counter.component.ts`);
            mockery.registerMock('fs', {
                statSync: (path: string) => {
                    if (normalized(path) === tsFileCanonicalized) {
                        return true;
                    }

                    throw new Error(`File doesn't exist: ${path}`);
                },
                stat: (path: string, cb) => {
                    if (normalized(path) === tsFileCanonicalized) {
                        cb(undefined, true);
                    }

                    throw new Error(`File doesn't exist: ${path}`);
                }
            });

            assert.deepEqual(
                normalized(getSourceMapUtils().applySourceMapPathOverrides('webpack:///./src/app/counter/counter.component.ts', { 'webpack:///./*': testUtils.pathResolve(`${projectFolder}/webRoot/*`) }, true)),
                normalized(`${projectFolder}/ClientApp/src/app/counter/counter.component.ts`));
        });

        test('Does not add ClientApp to the path in VisualStudio as a fallback to the ASP.NET Angular Template in 2.1 when the original method finds a file', () => {
            mockery.resetCache();
            mockery.registerMock('fs', {
                stat: (path: string, cb) => cb(undefined, true)
            });

            assert.deepEqual(
                normalized(getSourceMapUtils().applySourceMapPathOverrides('webpack:///./src/app/counter/counter.component.ts', { 'webpack:///./*': testUtils.pathResolve(`${projectFolder}/webRoot/*`) }, true)),
                normalized(`${projectFolder}/webRoot/src/app/counter/counter.component.ts`));
        });

        test('works using the laptop emoji', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('meteor:///💻app/src/main.js', { 'meteor:///💻app/*': testUtils.pathResolve('/project/*') }),
                testUtils.pathResolve('/project/src/main.js'));
        });

        test('does nothing when no overrides match', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('file:///c:/project/app.js', { 'webpack:///*': testUtils.pathResolve('/project/*') }),
                'file:///c:/project/app.js');
        });

        test('resolves ..', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('/project/source/app.js', { '/project/source/*': testUtils.pathResolve('/') + 'project/../*' }),
                testUtils.pathResolve('/app.js'));
        });

        test(`does nothing when match but asterisks don't match`, () => {
            assert.deepEqual(
                applySourceMapPathOverrides('webpack:///src/app.js', { 'webpack:///src/app.js': testUtils.pathResolve('/project/*') }),
                'webpack:///src/app.js');
        });

        test(`does nothing when match but too many asterisks`, () => {
            assert.deepEqual(
                applySourceMapPathOverrides('webpack:///src/code/app.js', { 'webpack:///*/code/app.js': testUtils.pathResolve('/project/*/*') }),
                'webpack:///src/code/app.js');
        });

        test('replaces an asterisk in the middle', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('webpack:///src/app.js', { 'webpack:///*/app.js': testUtils.pathResolve('/project/*/app.js') }),
                testUtils.pathResolve('/project/src/app.js'));
        });

        test('replaces an asterisk at the beginning', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('/src/app.js', { '*/app.js': testUtils.pathResolve('/project/*/app.js') }),
                testUtils.pathResolve('/project/src/app.js'));
        });

        test('allows some regex characters in the pattern', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('webpack+(foo):///src/app.js', { 'webpack+(foo):///*/app.js': testUtils.pathResolve('/project/*/app.js') }),
                testUtils.pathResolve('/project/src/app.js'));
        });

        test('replaces correctly when asterisk on left but not right', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('/src/app.js', { '*/app.js': testUtils.pathResolve('/project/app.js') }),
                testUtils.pathResolve('/project/app.js'));
        });

        test('the pattern is case-insensitive', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('/src/app.js', { '*/APP.js': testUtils.pathResolve('/project/*/app.js') }),
                testUtils.pathResolve('/project/src/app.js'));
        });

        test('works when multiple overrides provided', () => {
            assert.deepEqual(
                applySourceMapPathOverrides(
                    '/src/app.js',
                    {
                        'foo': 'bar',
                        '/file.js': testUtils.pathResolve('/main.js'),
                        '*/app.js': testUtils.pathResolve('/project/*/app.js'),
                        '/something/*/else.js': 'main.js'
                    }),
                testUtils.pathResolve('/project/src/app.js'));
        });

        test('applies overrides in order by longest key first', () => {
            assert.deepEqual(
                applySourceMapPathOverrides(
                    '/src/app.js',
                    {
                        '*': testUtils.pathResolve('/main.js'),
                        '*/app.js': testUtils.pathResolve('/project/*/app.js'),
                        '*.js': 'main.js'
                    }),
                testUtils.pathResolve('/project/src/app.js'));
        });

        test('is slash agnostic', () => {
            assert.deepEqual(
                applySourceMapPathOverrides('/src/app.js', { '*\\app.js': testUtils.pathResolve('/*/app.js') }),
                testUtils.pathResolve('/src/app.js'));

            if (os.platform() === 'win32') {
                assert.deepEqual(
                    applySourceMapPathOverrides('C:\\foo\\src\\app.js', { 'C:\\foo\\*': 'C:\\bar\\*' }),
                    'C:\\bar\\src\\app.js');
            }
        });
    });

    suite('resolveMapPath', () => {
        test('works for a relative local path', () => {
            const scriptPath = testUtils.pathResolve('/project/app.js');
            assert.equal(resolveMapPath(scriptPath, 'app.js.map', {}), scriptPath + '.map');
            assert.equal(resolveMapPath(scriptPath, './app.js.map', {}), scriptPath + '.map');
        });

        test('works for a web relative path', () => {
            const scriptUrl = 'http://localhost:8080/project/app.js';
            assert.equal(resolveMapPath(scriptUrl, 'app.js.map', {}), scriptUrl + '.map');
            assert.equal(resolveMapPath(scriptUrl, './app.js.map', {}), scriptUrl + '.map');
        });

        test('works for a full url with local script', () => {
            const urlMap = 'http://localhost/app.js.map';
            const scriptUrl = testUtils.pathResolve('/project/app.js');
            assert.equal(resolveMapPath(scriptUrl, urlMap, {}), urlMap);
        });

        test('works for a full url with url script', () => {
            const urlMap = 'http://localhost/app.js.map';
            const scriptUrl = 'http://localhost:8080/project/app.js';
            assert.equal(resolveMapPath(scriptUrl, urlMap, {}), urlMap);
        });

        test('works for a /path', () => {
            const slashPath = '/maps/app.js.map';
            const scriptUrl = 'http://localhost:8080/project/app.js';
            assert.equal(resolveMapPath(scriptUrl, slashPath, {}), 'http://localhost:8080/maps/app.js.map');
        });

        test('applies pathMappings for /path and local path', () => {
            const slashPath = '/maps/app.js.map';
            const scriptUrl = testUtils.pathResolve('/foo/bar/project/app.js');
            assert.equal(resolveMapPath(scriptUrl, slashPath, { '/' : testUtils.pathResolve('/foo/bar') }), testUtils.pathResolve('/foo/bar/maps/app.js.map'));
        });

        test('works for /local path without valid pathMapping', () => {
            const slashPath = '/maps/app.js.map';
            const scriptUrl = testUtils.pathResolve('/foo/bar/project/app.js');
            assert.equal(resolveMapPath(scriptUrl, slashPath, { }), '/maps/app.js.map');
        });

        test('works for c:/local path without valid pathMapping', () => {
            const slashPath = 'c:/maps/app.js.map';
            const scriptUrl = testUtils.pathResolve('/foo/bar/project/app.js');
            assert.equal(resolveMapPath(scriptUrl, slashPath, { }), 'c:/maps/app.js.map');
        });

        test('works for a file:/// url', () => {
            const winFileUrl = 'file:///c:/project/app.js.map';
            const notWinFileUrl = 'file:///project/app.js.map';
            const scriptUrl = 'http://localhost:8080/project/app.js';
            assert.equal(resolveMapPath(scriptUrl, winFileUrl, {}), winFileUrl);
            assert.equal(resolveMapPath(scriptUrl, notWinFileUrl, {}), notWinFileUrl);
        });

        // https://github.com/Microsoft/vscode-chrome-debug/issues/268
        test('works for an eval script', () => {
            const scriptPath = 'eval://53';
            const sourceMapPath = 'foo.min.js';
            assert.equal(resolveMapPath(scriptPath, sourceMapPath, {}), null);
        });
    });

    suite('getFullSourceEntry', () => {
        test('works', () => {
            assert.equal(getFullSourceEntry(undefined, 'foo/bar.js'), 'foo/bar.js');
            assert.equal(getFullSourceEntry('webpack:///', 'foo/bar.js'), 'webpack:///foo/bar.js');
            assert.equal(getFullSourceEntry('webpack:///project', 'foo/bar.js'), 'webpack:///project/foo/bar.js');
            assert.equal(getFullSourceEntry('webpack:///project/', 'foo/bar.js'), 'webpack:///project/foo/bar.js');

            assert.equal(getFullSourceEntry('file:///c:/project', 'foo/bar.js'), 'file:///c:/project/foo/bar.js');

            assert.equal(getFullSourceEntry('/', 'foo/bar.js'), '/foo/bar.js');
            assert.equal(getFullSourceEntry('/project/', 'foo/bar.js'), '/project/foo/bar.js');
            assert.equal(getFullSourceEntry('project/', 'foo/bar.js'), 'project/foo/bar.js');
            assert.equal(getFullSourceEntry('./project/', 'foo/bar.js'), './project/foo/bar.js');
        });
    });
});
