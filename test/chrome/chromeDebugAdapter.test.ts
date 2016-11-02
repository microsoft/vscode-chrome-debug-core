/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';

import {getMockLineNumberTransformer, getMockPathTransformer, getMockSourceMapTransformer} from '../mocks/transformerMocks';
import {getMockChromeConnectionApi, IMockChromeConnectionAPI} from '../mocks/debugProtocolMocks';

import {ISetBreakpointsResponseBody, IEvaluateResponseBody} from '../../src/debugAdapterInterfaces';
import {ChromeConnection} from '../../src/chrome/chromeConnection';

import {LineColTransformer} from '../../src/transformers/lineNumberTransformer';
import {BaseSourceMapTransformer} from '../../src/transformers/baseSourceMapTransformer';
import {UrlPathTransformer} from '../../src/transformers/urlPathTransformer';

import * as mockery from 'mockery';
import {EventEmitter} from 'events';
import * as assert from 'assert';
import {Mock, MockBehavior, It} from 'typemoq';
import Crdp from '../../crdp/crdp';

import * as testUtils from '../testUtils';
import * as utils from '../../src/utils';

/** Not mocked - use for type only */
import {ChromeDebugAdapter as _ChromeDebugAdapter} from '../../src/chrome/chromeDebugAdapter';

const MODULE_UNDER_TEST = '../../src/chrome/chromeDebugAdapter';
suite('ChromeDebugAdapter', () => {
    const ATTACH_SUCCESS_PORT = 9222;
    const ATTACH_FAIL_PORT = 2992;
    const ATTACH_ARGS = { port: ATTACH_SUCCESS_PORT };
    const THREAD_ID = 1;

    let mockChromeConnection: Mock<ChromeConnection>;
    let mockEventEmitter: EventEmitter;
    let mockLineNumberTransformer: Mock<LineColTransformer>;
    let mockSourceMapTransformer: Mock<BaseSourceMapTransformer>;
    let mockPathTransformer: Mock<UrlPathTransformer>;
    let mockChrome: IMockChromeConnectionAPI;

    let chromeDebugAdapter: _ChromeDebugAdapter;
    let sendEventHandler: (e: DebugProtocol.Event) => void;

    setup(() => {
        testUtils.setupUnhandledRejectionListener();
        mockery.enable({ useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false });
        testUtils.registerWin32Mocks();

        // Create a ChromeConnection mock with .on and .attach. Tests can fire events via mockEventEmitter
        mockChromeConnection = Mock.ofType(ChromeConnection, MockBehavior.Strict);
        mockChromeConnection
            .setup(x => x.attach(It.isValue(undefined), It.isValue(ATTACH_SUCCESS_PORT), It.isValue(undefined)))
            .returns(() => Promise.resolve());
        mockChromeConnection
            .setup(x => x.attach(It.isValue(undefined), It.isValue(ATTACH_FAIL_PORT), It.isValue(undefined)))
            .returns(() => utils.errP('Testing attach failed'));
        mockChromeConnection
            .setup(x => x.isAttached)
            .returns(() => false);
        mockChromeConnection
            .setup(x => x.onClose(It.isAny()));

        mockChrome = getMockChromeConnectionApi();
        mockEventEmitter = mockChrome.mockEventEmitter;
        mockChromeConnection
            .setup(x => x.api)
            .returns(() => mockChrome.apiObjects);
        mockChromeConnection
            .setup(x => x.run())
            .returns(() => Promise.resolve());

        mockLineNumberTransformer = getMockLineNumberTransformer();
        mockSourceMapTransformer = getMockSourceMapTransformer();
        mockPathTransformer = getMockPathTransformer();

        // Instantiate the ChromeDebugAdapter, injecting the mock ChromeConnection
        /* tslint:disable */
        chromeDebugAdapter = new (require(MODULE_UNDER_TEST).ChromeDebugAdapter)({
            chromeConnection: function() { return mockChromeConnection.object; },
            lineColTransformer: function() { return mockLineNumberTransformer.object; },
            sourceMapTransformer: function() { return mockSourceMapTransformer.object; },
            pathTransformer: function() { return mockPathTransformer.object; }
        },
        {
            sendEvent: (e: DebugProtocol.Event) => {
                if (sendEventHandler) {
                    // Filter telemetry events
                    if (!(e.event === 'output' && (<DebugProtocol.OutputEvent>e).body.category === 'telemetry')) {
                        sendEventHandler(e);
                    }
                }
            }
        });
        /* tslint:enable */
    });

    teardown(() => {
        sendEventHandler = undefined;
        testUtils.removeUnhandledRejectionListener();
        mockery.deregisterAll();
        mockery.disable();

        mockChromeConnection.verifyAll();
        mockChrome.Debugger.verifyAll();
    });

    function emitScriptParsed(url, scriptId): void {
        mockSourceMapTransformer.setup(m => m.scriptParsed(It.isValue(undefined), It.isValue(undefined)))
            .returns(() => Promise.resolve([]));

        mockEventEmitter.emit('Debugger.scriptParsed', <Crdp.Debugger.ScriptParsedEvent>{ scriptId, url });
    }

    suite('attach()', () => {
        test('if successful, an initialized event is fired', () => {
            let initializedFired = false;

            sendEventHandler = (event: DebugProtocol.Event) => {
                if (event.event === 'initialized') {
                    initializedFired = true;
                } else {
                    testUtils.assertFail('An unexpected event was fired');
                }
            };

            return chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                assert(initializedFired, 'Attach completed without firing the initialized event');
            });
        });

        test('if unsuccessful, the promise is rejected and an initialized event is not fired', (done) => {
            sendEventHandler = (event: DebugProtocol.Event) => {
                done(new Error('Not expecting any event in this scenario: ' + event.event));
            };

            chromeDebugAdapter.attach({ port: ATTACH_FAIL_PORT }).then(
                () => done(new Error('Expecting promise to be rejected')),
                e => { done(); /* Expecting promise to be rejected */ });
        });
    });

    suite('setBreakpoints()', () => {
        const BP_ID = 'bpId';
        const FILE_NAME = 'file:///a.js';
        const SCRIPT_ID = '1';
        function expectSetBreakpoint(breakpoints: DebugProtocol.SourceBreakpoint[], url?: string, scriptId = SCRIPT_ID): void {
            breakpoints.forEach((bp, i) => {
                const { line: lineNumber, column: columnNumber, condition } = bp;

                if (url) {
                    const urlRegex = utils.pathToRegex(url);
                    mockChrome.Debugger
                        .setup(x => x.setBreakpointByUrl(It.isValue({ urlRegex, lineNumber, columnNumber, condition })))
                        .returns(location => Promise.resolve(
                            <Crdp.Debugger.SetBreakpointByUrlResponse>{ breakpointId: BP_ID + i, locations: [{ scriptId, lineNumber, columnNumber }] }))
                        .verifiable();
                } else {
                    mockChrome.Debugger
                        .setup(x => x.setBreakpoint(It.isValue({ location: { lineNumber, columnNumber, scriptId }, condition })))
                        .returns(location => Promise.resolve(
                            <Crdp.Debugger.SetBreakpointResponse>{ breakpointId: BP_ID + i, actualLocation: { scriptId, lineNumber, columnNumber } }))
                        .verifiable();
                }
            });
        }

        function expectRemoveBreakpoint(indicies: number[]): void {
            indicies.forEach(i => {
                mockChrome.Debugger
                    .setup(x => x.removeBreakpoint(It.isValue({ breakpointId: BP_ID + i })))
                    .returns(() => Promise.resolve())
                    .verifiable();
            });
        }

        function makeExpectedResponse(breakpoints: DebugProtocol.SourceBreakpoint[]): ISetBreakpointsResponseBody {
            const resultBps = breakpoints.map((bp, i) => ({
                line: bp.line,
                column: bp.column || 0,
                verified: true
            }));

            return { breakpoints: resultBps };
        }

        function assertExpectedResponse(response: ISetBreakpointsResponseBody, breakpoints: DebugProtocol.SourceBreakpoint[]): void {
            // Assert that each bp has some id, then remove, because we don't know or care what it is
            response.breakpoints.forEach(bp => {
                assert(typeof bp.id === 'number');
                delete bp.id;
            });

            assert.deepEqual(response, makeExpectedResponse(breakpoints));
        }

        function setBp_emitScriptParsed(url = FILE_NAME, scriptId = SCRIPT_ID): void {
            emitScriptParsed(url, scriptId);
        }

        test('When setting one breakpoint, returns the correct result', () => {
            const breakpoints: DebugProtocol.SourceBreakpoint[] = [
                { line: 5, column: 6 }
            ];
            expectSetBreakpoint(breakpoints, FILE_NAME);

            return chromeDebugAdapter.attach(ATTACH_ARGS)
                .then(() => setBp_emitScriptParsed())
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints }, 0))
                .then(response => assertExpectedResponse(response, breakpoints));
        });

        test('When setting multiple breakpoints, returns the correct result', () => {
            const breakpoints = [
                { line: 14, column: 33 },
                { line: 200, column: 16 },
                { line: 151, column: 1 }
            ];
            expectSetBreakpoint(breakpoints, FILE_NAME);

            return chromeDebugAdapter.attach(ATTACH_ARGS)
                .then(() => setBp_emitScriptParsed())
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints}, 0))
                .then(response => assertExpectedResponse(response, breakpoints));
        });

        test('The adapter clears all previous breakpoints in a script before setting the new ones', () => {
            const breakpoints = [
                { line: 14, column: 33 },
                { line: 200, column: 16 }
            ];
            expectSetBreakpoint(breakpoints, FILE_NAME);

            return chromeDebugAdapter.attach(ATTACH_ARGS)
                .then(() => setBp_emitScriptParsed())
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints }, 0))
                .then(response => {
                    breakpoints.push({ line: 321, column: 123 });

                    expectRemoveBreakpoint([0, 1]);
                    expectSetBreakpoint(breakpoints, FILE_NAME);

                    return chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints }, 0);
                })
                .then(response => assertExpectedResponse(response, breakpoints));
        });

        test('The adapter handles removing a breakpoint', () => {
            const breakpoints = [
                { line: 14, column: 33 },
                { line: 200, column: 16 }
            ];
            expectSetBreakpoint(breakpoints, FILE_NAME);

            return chromeDebugAdapter.attach(ATTACH_ARGS)
                .then(() => setBp_emitScriptParsed())
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints}, 0))
                .then(response => {
                    breakpoints.shift();

                    expectRemoveBreakpoint([0, 1]);
                    expectSetBreakpoint(breakpoints, FILE_NAME);
                    return chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints}, 0);
                })
                .then(response => assertExpectedResponse(response, breakpoints));
        });

        test('After a page refresh, clears the newly resolved breakpoints before adding new ones', () => {
            const breakpoints = [
                { line: 14, column: 33 },
                { line: 200, column: 16 }
            ];
            expectSetBreakpoint(breakpoints, FILE_NAME);

            return chromeDebugAdapter.attach(ATTACH_ARGS)
                .then(() => setBp_emitScriptParsed())
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints }, 0))
                .then(response => {
                    expectRemoveBreakpoint([2, 3]);
                    mockEventEmitter.emit('Debugger.globalObjectCleared');
                    mockEventEmitter.emit('Debugger.scriptParsed', <Crdp.Debugger.ScriptParsedEvent>{ scriptId: 'afterRefreshScriptId', url: FILE_NAME });
                    mockEventEmitter.emit('Debugger.breakpointResolved', <Crdp.Debugger.BreakpointResolvedEvent>{ breakpointId: BP_ID + 2, location: { scriptId: 'afterRefreshScriptId' } });
                    mockEventEmitter.emit('Debugger.breakpointResolved', <Crdp.Debugger.BreakpointResolvedEvent>{ breakpointId: BP_ID + 3, location: { scriptId: 'afterRefreshScriptId' } });

                    breakpoints.push({ line: 321, column: 123 });
                    expectSetBreakpoint(breakpoints, FILE_NAME, 'afterRefreshScriptId');
                    return chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints }, 0);
                })
                .then(response => assertExpectedResponse(response, breakpoints));
        });

        test('returns the actual location specified by the runtime', () => {
            const breakpoints: DebugProtocol.SourceBreakpoint[] = [
                { line: 5, column: 6 }
            ];

            // Set up the mock to return a different location
            const location: Crdp.Debugger.Location = {
                scriptId: SCRIPT_ID, lineNumber: breakpoints[0].line + 10, columnNumber: breakpoints[0].column + 10 };
            const expectedResponse: ISetBreakpointsResponseBody = {
                breakpoints: [{ line: location.lineNumber, column: location.columnNumber, verified: true, id: 1000 }]};

            const expectedRegex = utils.pathToRegex(FILE_NAME);
            mockChrome.Debugger
                .setup(x => x.setBreakpointByUrl(It.isValue({ urlRegex: expectedRegex, lineNumber: breakpoints[0].line, columnNumber: breakpoints[0].column, condition: undefined })))
                .returns(() => Promise.resolve(
                    <Crdp.Debugger.SetBreakpointByUrlResponse>{ breakpointId: BP_ID, locations: [location] }))
                .verifiable();

            return chromeDebugAdapter.attach(ATTACH_ARGS)
                .then(() => setBp_emitScriptParsed())
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: FILE_NAME }, breakpoints }, 0))
                .then(response => assert.deepEqual(response, expectedResponse));
        });

        test('setting breakpoints in a sourcemapped eval script handles the placeholder url', () => {
            const breakpoints: DebugProtocol.SourceBreakpoint[] = [
                { line: 5, column: 6 }
            ];
            expectSetBreakpoint(breakpoints);

            return chromeDebugAdapter.attach(ATTACH_ARGS)
                .then(() => setBp_emitScriptParsed(/*url=*/'', SCRIPT_ID))
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: 'eval://' + SCRIPT_ID }, breakpoints }, 0))
                .then(response => assertExpectedResponse(response, breakpoints));
        });
    });

    suite('Console.messageAdded', () => {
        test('Fires an output event when a console message is added', () => {
            const testLog = 'Hello, world!';
            let outputEventFired = false;
            sendEventHandler = (event: DebugProtocol.Event) => {
                if (event.event === 'output') {
                    outputEventFired = true;
                    assert.equal(event.body.text, testLog);
                } else {
                    testUtils.assertFail('An unexpected event was fired');
                }
            };

            mockEventEmitter.emit('Console.onMessageAdded', {
                message: {
                    source: 'console-api',
                    level: 'log',
                    type: 'log',
                    text: testLog,
                    timestamp: Date.now(),
                    line: 2,
                    column: 13,
                    url: 'file:///c:/page/script.js',
                    executionContextId: 2,
                    parameters: [
                        { type: 'string', value: testLog }
                    ]
                }
            });
        });
    });

    suite('Debugger.scriptParsed', () => {
        const FILE_NAME = 'file:///a.js';
        const SCRIPT_ID = '1';
        function emitScriptParsed(url = FILE_NAME, scriptId = SCRIPT_ID, otherArgs: any = {}): void {
            otherArgs.url = url;
            otherArgs.scriptId = scriptId;

            mockEventEmitter.emit('Debugger.scriptParsed', otherArgs);
        }

        test('adds default url when missing', () => {
            let scriptParsedFired = false;
            return chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                mockPathTransformer.setup(m => m.scriptParsed(It.isAnyString()))
                    .returns(url => {
                        scriptParsedFired = true;
                        assert(!!url); // Should be called with some default url
                        return url;
                    });
                mockSourceMapTransformer.setup(m => m.scriptParsed(It.isAny(), It.isValue(undefined)))
                    .returns(() => Promise.resolve([]));

                emitScriptParsed(/*url=*/'');
                assert(scriptParsedFired);
            });
        });

    });

    suite('evaluate()', () => {
        function getExpectedValueResponse(resultObj: Crdp.Runtime.RemoteObject): IEvaluateResponseBody {
            let result: string;
            let variablesReference = 0;
            if (resultObj.type === 'string') {
                result = resultObj.description;
            }

            return {
                result,
                variablesReference,
                indexedVariables: undefined,
                namedVariables: undefined
            };
        }

        function setupEvalMock(expression: string, result: Crdp.Runtime.RemoteObject): void {
            mockChrome.Runtime
                .setup(x => x.evaluate(It.isValue({ expression, silent: true, generatePreview: true })))
                .returns(() => Promise.resolve(<Crdp.Runtime.EvaluateResponse>{ result }));
        }

        function setupEvalOnCallFrameMock(expression: string, callFrameId: string, result: Crdp.Runtime.RemoteObject): void {
            mockChrome.Debugger
                .setup(x => x.evaluateOnCallFrame(It.isValue({ expression, callFrameId, silent: true, generatePreview: true })))
                .returns(() => Promise.resolve(<Crdp.Runtime.EvaluateResponse>{ result }));
        }

        test('calls Runtime.evaluate when not paused', () => {
            const expression = '1+1';
            const result: Crdp.Runtime.RemoteObject = { type: 'string', description: '2' };
            setupEvalMock(expression, result);

            return chromeDebugAdapter.evaluate({ expression }).then(response => {
                assert.deepEqual(response, getExpectedValueResponse(result));
            });
        });

        test('calls Debugger.evaluateOnCallFrame when paused', () => {
            const callFrameId = '1';
            const expression = '1+1';
            const result: Crdp.Runtime.RemoteObject = { type: 'string', description: '2' };
            setupEvalOnCallFrameMock(expression, callFrameId, result);

            // Sue me (just easier than sending a Debugger.paused event)
            (<any>chromeDebugAdapter)._frameHandles = { get: () => ({ callFrameId })};

            return chromeDebugAdapter.evaluate({ expression, frameId: 0 }).then(response => {
                assert.deepEqual(response, getExpectedValueResponse(result));
            });
        });
    });

    suite('Debugger.pause', () => {
        test('returns the same sourceReferences for the same scripts', () => {
            return chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                const scriptId = 'script1';
                const location: Crdp.Debugger.Location = { lineNumber: 0, columnNumber: 0, scriptId };
                const callFrame = { callFrameId: 'id1', location };
                emitScriptParsed('', scriptId);
                mockEventEmitter.emit('Debugger.paused', <Crdp.Debugger.PausedEvent>{callFrames: [callFrame, callFrame]});

                const stackFrames = chromeDebugAdapter.stackTrace({ threadId: THREAD_ID }).stackFrames;

                // Should have two stack frames with the same sourceReferences
                assert.equal(stackFrames.length, 2);
                assert.equal(stackFrames[0].source.sourceReference, stackFrames[1].source.sourceReference);
                const sourceReference = stackFrames[0].source.sourceReference;

                // If it pauses a second time, and we request another stackTrace, should have the same result
                mockEventEmitter.emit('Debugger.paused', <Crdp.Debugger.PausedEvent>{callFrames: [callFrame, callFrame]});
                const stackFrames2 = chromeDebugAdapter.stackTrace({ threadId: THREAD_ID }).stackFrames;
                assert.equal(stackFrames2.length, 2);
                assert.equal(stackFrames2[0].source.sourceReference, sourceReference);
                assert.equal(stackFrames2[1].source.sourceReference, sourceReference);
            });
        });
    });

    suite('setExceptionBreakpoints()', () => { });
    suite('stepping', () => { });
    suite('stackTrace()', () => { });
    suite('scopes()', () => { });
    suite('variables()', () => { });
    suite('source()', () => { });
    suite('threads()', () => { });

    suite('Debugger.resume', () => { });
    suite('target close/error/detach', () => { });
});
