/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/* tslint:disable:typedef */

import { DebugProtocol } from 'vscode-debugprotocol';

import * as assert from 'assert';
import * as mockery from 'mockery';
import { Mock, MockBehavior, It, IMock, Times } from 'typemoq';

import { ISetBreakpointsResponseBody,
    ILaunchRequestArgs, ISetBreakpointsArgs } from '../../src/debugAdapterInterfaces';
import * as testUtils from '../testUtils';
import { SourceMaps } from '../../src/sourceMaps/sourceMaps';
import { MappedPosition } from '../../src/sourceMaps/sourceMap';
import * as utils from '../../src/utils';

/* tslint:disable:no-function-expression */

const MODULE_UNDER_TEST = '../../src/transformers/baseSourceMapTransformer';

const AUTHORED_PATH = testUtils.pathResolve('/project/authored.ts');
const RUNTIME_FILE = 'runtime.js';
const RUNTIME_PATH = testUtils.pathResolve('/project', RUNTIME_FILE);

// These are fns because the data will be modified by tests
const AUTHORED_BPS = () => <DebugProtocol.SourceBreakpoint[]>[
        { line: 1, column: 4 },
        { line: 2, column: 5 },
        { line: 3, column: 6 }
    ];
const RUNTIME_BPS = () => <DebugProtocol.SourceBreakpoint[]>[
        { line: 2, column: 3 },
        { line: 5, column: 7 },
        { line: 8, column: 11 }
    ];

const AUTHORED_PATH2 = testUtils.pathResolve('/project/authored2.ts');
const AUTHORED_BPS2 = () => <DebugProtocol.SourceBreakpoint[]>[
        { line: 90, column: 5 },
        { line: 105, column: 6 }
    ];
const RUNTIME_BPS2 = () => <DebugProtocol.SourceBreakpoint[]>[
        { line: 78, column: 0 },
        { line: 81, column: 1 }
    ];

// Not mocked, use for type only
import {BaseSourceMapTransformer as _BaseSourceMapTransformer } from '../../src/transformers/baseSourceMapTransformer';

suite('BaseSourceMapTransformer', () => {
    let utilsMock: IMock<typeof utils>;

    setup(() => {
        testUtils.setupUnhandledRejectionListener();

        // Mock the utils module
        utilsMock = Mock.ofInstance(utils);
        utilsMock.callBase = true;
        mockery.registerMock('../utils', utilsMock.object);

        // Set up mockery
        mockery.enable({ warnOnReplace: false, useCleanCache: true, warnOnUnregistered: false });
    });

    teardown(() => {
        testUtils.removeUnhandledRejectionListener();
        mockery.deregisterAll();
        mockery.disable();
    });

    function getTransformer(sourceMaps = true, suppressDefaultMock = false): _BaseSourceMapTransformer {
        if (!suppressDefaultMock) {
            mockery.registerMock('../sourceMaps/sourceMaps', { SourceMaps: StubSourceMaps });
        }

        let BaseSourceMapTransformer = require(MODULE_UNDER_TEST).BaseSourceMapTransformer;
        const transformer = new BaseSourceMapTransformer();
        transformer.launch(<ILaunchRequestArgs><any>{
            sourceMaps,
            generatedCodeDirectory: 'test'
        });

        return transformer;
    }

    suite('setBreakpoints()', () => {
        function createArgs(path: string, breakpoints: DebugProtocol.SourceBreakpoint[]): ISetBreakpointsArgs {
            return {
                source: { path },
                breakpoints
            };
        }

        function createExpectedArgs(authoredPath: string, path: string, breakpoints: DebugProtocol.SourceBreakpoint[]): ISetBreakpointsArgs {
            const args = createArgs(path, breakpoints);
            args.authoredPath = authoredPath;
            return args;
        }

        function createMergedSourcesMock(args: ISetBreakpointsArgs, args2: ISetBreakpointsArgs): IMock<SourceMaps> {
            const mock = Mock.ofType(SourceMaps, MockBehavior.Strict);
            mockery.registerMock('../sourceMaps/sourceMaps', { SourceMaps: function(): any { return mock.object; } });
            mock
                .setup(x => x.getGeneratedPathFromAuthoredPath(It.isValue(AUTHORED_PATH)))
                .returns(() => RUNTIME_PATH)
                .verifiable(Times.atLeastOnce());
            mock
                .setup(x => x.getGeneratedPathFromAuthoredPath(It.isValue(AUTHORED_PATH2)))
                .returns(() => RUNTIME_PATH)
                .verifiable(Times.atLeastOnce());
            mock
                .setup(x => x.allMappedSources(It.isValue(RUNTIME_PATH)))
                .returns(() => [AUTHORED_PATH, AUTHORED_PATH2])
                .verifiable(Times.atLeastOnce());
            args.breakpoints.forEach((bp, i) => {
                mock
                    .setup(x => x.mapToGenerated(It.isValue(AUTHORED_PATH), It.isValue(bp.line), It.isValue(bp.column || 0)))
                    .returns(() => ({ source: RUNTIME_PATH, line: RUNTIME_BPS()[i].line, column: RUNTIME_BPS()[i].column })).verifiable();
            });
            args2.breakpoints.forEach((bp, i) => {
                mock
                    .setup(x => x.mapToGenerated(It.isValue(AUTHORED_PATH2), It.isValue(bp.line), It.isValue(bp.column || 0)))
                    .returns(() => ({ source: RUNTIME_PATH, line: RUNTIME_BPS2()[i].line, column: RUNTIME_BPS2()[i].column })).verifiable();
            });

            return mock;
        }

        test('modifies the source and lines', () => {
            const args = createArgs(AUTHORED_PATH, AUTHORED_BPS());
            const expected = createExpectedArgs(AUTHORED_PATH, RUNTIME_PATH, RUNTIME_BPS());

            getTransformer().setBreakpoints(args, 0);
            assert.deepEqual(args, expected);
        });

        test(`doesn't do anything when sourcemaps are disabled`, () => {
            const args = createArgs(RUNTIME_PATH, RUNTIME_BPS());
            const expected = createArgs(RUNTIME_PATH, RUNTIME_BPS());

            getTransformer(/*sourceMaps=*/false).setBreakpoints(args, 0);
            assert.deepEqual(args, expected);
        });

        // #106
        test.skip(`if the source can't be mapped, waits until the runtime script is loaded`, async () => {
            const args = createArgs(AUTHORED_PATH, AUTHORED_BPS());
            const expected = createExpectedArgs(AUTHORED_PATH, RUNTIME_PATH, RUNTIME_BPS());
            const sourceMapURL = 'script.js.map';

            const mock = Mock.ofType(SourceMaps, MockBehavior.Strict);
            mockery.registerMock('../sourceMaps/sourceMaps', { SourceMaps: function() { return mock.object; } });
            mock
                .setup(x => x.getGeneratedPathFromAuthoredPath(It.isValue(AUTHORED_PATH)))
                .returns(() => null).verifiable();
            mock
                .setup(x => x.getGeneratedPathFromAuthoredPath(It.isValue(AUTHORED_PATH)))
                .returns(() => RUNTIME_PATH).verifiable();
            mock
                .setup(x => x.allMappedSources(It.isValue(RUNTIME_PATH)))
                .returns(() => [AUTHORED_PATH]).verifiable();
            mock
                .setup(x => x.processNewSourceMap(It.isValue(RUNTIME_PATH), undefined, It.isValue(sourceMapURL)))
                .returns(() => Promise.resolve()).verifiable();
            args.breakpoints.forEach((bp, i) => {
                mock
                    .setup(x => x.mapToGenerated(It.isValue(AUTHORED_PATH), It.isValue(bp.line), It.isValue(bp.column || 0)))
                    .returns(() => ({ source: RUNTIME_PATH, line: RUNTIME_BPS()[i].line, column: RUNTIME_BPS()[i].column })).verifiable();
            });

            const transformer = getTransformer(/*sourceMaps=*/true, /*suppressDefaultMock=*/true);
            transformer.setBreakpoints(args, /*requestSeq=*/0);
            assert.deepEqual(args, expected);
            mock.verifyAll();

            await transformer.scriptParsed(RUNTIME_PATH, undefined, sourceMapURL);
            // return setBreakpointsP;
        });

        test('if the source maps to a merged file, includes the breakpoints in other files that map to the same file', () => {
            const args = createArgs(AUTHORED_PATH, AUTHORED_BPS());
            const args2 = createArgs(AUTHORED_PATH2, AUTHORED_BPS2());
            const expected = createExpectedArgs(AUTHORED_PATH2, RUNTIME_PATH, RUNTIME_BPS2().concat(RUNTIME_BPS()));
            const mock = createMergedSourcesMock(args, args2);

            const transformer = getTransformer(/*sourceMaps=*/true, /*suppressDefaultMock=*/true);
            transformer.setBreakpoints(args, 0);
            transformer.setBreakpoints(args2, 1);

            assert.deepEqual(args2, expected);
            mock.verifyAll();
        });

        suite('setBreakpointsResponse()', () => {
            function getResponseBody(breakpoints: DebugProtocol.SourceBreakpoint[]): ISetBreakpointsResponseBody {
                return {
                    breakpoints: breakpoints.map(({ line, column }) => {
                        return <DebugProtocol.Breakpoint> {
                            line,
                            column,
                            verified: true
                        };
                    })
                };
            }

            test('modifies the response source and breakpoints', () => {
                const response = getResponseBody(RUNTIME_BPS());
                const expected = getResponseBody(AUTHORED_BPS());

                const transformer = getTransformer();
                transformer.setBreakpoints(<DebugProtocol.SetBreakpointsArguments>{
                    source: { path: AUTHORED_PATH },
                    breakpoints: AUTHORED_BPS()
                }, 0);
                response.breakpoints = transformer.setBreakpointsResponse(response.breakpoints, true, 0);
                assert.deepEqual(response, expected);
            });

            test(`doesn't do anything when sourcemaps are disabled except remove the column`, () => {
                const response = getResponseBody(RUNTIME_BPS());
                const expected = getResponseBody(RUNTIME_BPS());

                const transformer = getTransformer(/*sourceMaps=*/false);
                transformer.setBreakpoints(<DebugProtocol.SetBreakpointsArguments>{
                    source: { path: RUNTIME_PATH },
                    breakpoints: RUNTIME_BPS()
                }, 0);
                response.breakpoints = transformer.setBreakpointsResponse(response.breakpoints, true, 0);
                assert.deepEqual(response, expected);
            });

            test(`if the source maps to a merged file, filters breakpoint results from other files`, () => {
                const setBPArgs = createArgs(AUTHORED_PATH, AUTHORED_BPS());
                const setBPArgs2 = createArgs(AUTHORED_PATH2, AUTHORED_BPS2());
                const response = getResponseBody(RUNTIME_BPS2().concat(RUNTIME_BPS()));
                const expected = getResponseBody(AUTHORED_BPS2());

                const mock = createMergedSourcesMock(setBPArgs, setBPArgs2);
                RUNTIME_BPS2().forEach((bp, i) => {
                    mock
                        .setup(x => x.mapToAuthored(It.isValue(RUNTIME_PATH), It.isValue(bp.line), It.isValue(bp.column)))
                        .returns(() => ({ source: AUTHORED_PATH2, line: AUTHORED_BPS2()[i].line, column: AUTHORED_BPS2()[i].column })).verifiable();
                });

                const transformer = getTransformer(/*sourceMaps=*/true, /*suppressDefaultMock=*/true);
                transformer.setBreakpoints(setBPArgs, /*requestSeq=*/0);
                transformer.setBreakpoints(setBPArgs2, /*requestSeq=*/1);
                response.breakpoints = transformer.setBreakpointsResponse(response.breakpoints, true, /*requestSeq=*/1);

                assert.deepEqual(response, expected);
                mock.verifyAll();
            });
        });
    });

    suite('stackTraceResponse()', () => {
        test('modifies the response stackFrames', async () => {
            utilsMock
                .setup(x => x.existsSync(It.isValue(AUTHORED_PATH)))
                .returns(() => true);

            const response = testUtils.getStackTraceResponseBody(RUNTIME_PATH, RUNTIME_BPS(), [1, 2, 3]);
            const expected = testUtils.getStackTraceResponseBody(AUTHORED_PATH, AUTHORED_BPS(), undefined, /*isSourceMapped=*/true);

            await getTransformer().stackTraceResponse(response);
            assert.deepEqual(response, expected);
        });

        test('doesn\'t clear the path when there are no sourcemaps', async () => {
            const response = testUtils.getStackTraceResponseBody(RUNTIME_PATH, RUNTIME_BPS(), [1, 2, 3]);

            await getTransformer(/*sourceMaps=*/false).stackTraceResponse(response);
            response.stackFrames.forEach(frame => assert(!!frame.source));
        });

        test(`keeps the path when the file can't be sourcemapped if it's on disk`, async () => {
            const mock = Mock.ofType(SourceMaps, MockBehavior.Strict);
            mockery.registerMock('../sourceMaps/sourceMaps', { SourceMaps: function() { return mock.object; } });

            RUNTIME_BPS().forEach(bp => {
                mock
                    .setup(x => x.mapToAuthored(It.isValue(RUNTIME_PATH), It.isValue(bp.line), It.isValue(bp.column)))
                    .returns(() => null).verifiable();
            });
            utilsMock
                .setup(x => x.existsSync(It.isValue(RUNTIME_PATH)))
                .returns(() => true);

            const response = testUtils.getStackTraceResponseBody(RUNTIME_PATH, RUNTIME_BPS(), [1, 2, 3]);
            const expected = testUtils.getStackTraceResponseBody(RUNTIME_PATH, RUNTIME_BPS());

            await getTransformer(/*sourceMaps=*/true, /*suppressDefaultMock=*/true).stackTraceResponse(response);
            assert.deepEqual(response, expected);
            mock.verifyAll();
        });

        test(`clears the name and leaves the path when it can't be sourcemapped and doesn't exist on disk`, async () => {
            const mock = Mock.ofType(SourceMaps, MockBehavior.Strict);
            mockery.registerMock('../sourceMaps/sourceMaps', { SourceMaps: function() { return mock.object; } });

            RUNTIME_BPS().forEach(bp => {
                mock
                    .setup(x => x.mapToAuthored(It.isValue(RUNTIME_PATH), It.isValue(bp.line), It.isValue(bp.column)))
                    .returns(() => null).verifiable();
            });
            utilsMock
                .setup(x => x.existsSync(It.isValue(RUNTIME_PATH)))
                .returns(() => false);

            const response = testUtils.getStackTraceResponseBody(RUNTIME_PATH, RUNTIME_BPS(), [1, 2, 3]);
            const expected = testUtils.getStackTraceResponseBody(RUNTIME_PATH, RUNTIME_BPS(), [1, 2, 3]);
            expected.stackFrames.forEach(stackFrame => {
                stackFrame.source.name =  RUNTIME_FILE;
            });

            await getTransformer(/*sourceMaps=*/true, /*suppressDefaultMock=*/true).stackTraceResponse(response);
            assert.deepEqual(response, expected);
            mock.verifyAll();
        });
    });
});

class StubSourceMaps {
    public getGeneratedPathFromAuthoredPath(path: string): string {
        return RUNTIME_PATH;
    }

    /*
     * Map location in source language to location in generated code.
     * line and column are 0 based.
     */
    public mapToGenerated(path: string, line: number, column: number): MappedPosition {
        const authored = AUTHORED_BPS();
        let i: number;
        for (i = 0; i < authored.length; i++) {
            if (authored[i].line === line && authored[i].column === column) break;
        }

        const mapping = RUNTIME_BPS()[i];
        return { source: RUNTIME_PATH, line: mapping.line, column: mapping.column };
    }

    /*
     * Map location in generated code to location in source language.
     * line and column are 0 based.
     */
    public mapToAuthored(path: string, line: number, column: number): MappedPosition {
        const runtime = RUNTIME_BPS();
        let i: number;
        for (i = 0; i < runtime.length; i++) {
            if (runtime[i].line === line && runtime[i].column === column) break;
        }

        const mapping = AUTHORED_BPS()[i];
        return { source: AUTHORED_PATH, line: mapping.line, column: mapping.column };
    }

    public allMappedSources(pathToGenerated: string): string[] {
        return [AUTHORED_PATH];
    }

    public processNewSourceMap(pathToGenerated: string, sourceMapURL: string): Promise<void> {
        return Promise.resolve();
    }
}
