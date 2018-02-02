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
import {ChromeDebugAdapter as _ChromeDebugAdapter, LoadedSourceEventReason} from '../../src/chrome/chromeDebugAdapter';
import { InitializedEvent, LoadedSourceEvent, Source } from 'vscode-debugadapter/lib/debugSession';

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
            .setup(x => x.attach(It.isValue(undefined), It.isValue(ATTACH_SUCCESS_PORT), It.isValue(undefined), It.isValue(undefined), It.isValue(undefined)))
            .returns(() => Promise.resolve());
        mockChromeConnection
            .setup(x => x.attach(It.isValue(undefined), It.isValue(ATTACH_FAIL_PORT), It.isValue(undefined), It.isValue(undefined)))
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

        initChromeDebugAdapter();
    });

    function initChromeDebugAdapter(): void {
        // Instantiate the ChromeDebugAdapter, injecting the mock ChromeConnection
        /* tslint:disable */
        chromeDebugAdapter = new (require(MODULE_UNDER_TEST).ChromeDebugAdapter)({
            chromeConnection: function () { return mockChromeConnection.object; },
            lineColTransformer: function () { return mockLineNumberTransformer.object; },
            sourceMapTransformer: function () { return mockSourceMapTransformer.object; },
            pathTransformer: function () { return mockPathTransformer.object; }
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
    }

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

    // Helper to run async asserts inside promises so they can be correctly awaited
    function asyncAssert(assertFn: Function, resolve: (value?: any) => void, reject: (reason?: any) => void): void {
        try {
            assertFn();
            resolve();
        } catch (e) {
            reject(e);
        }
    }

    suite('attach()', () => {
        test('Initialized event is fired after first scriptParsed event', done => {
            let firstEventReceived = false;
            sendEventHandler = (event: DebugProtocol.Event) => {
                if (!firstEventReceived && event.event === 'initialized') {
                    firstEventReceived = true;
                    done();
                } else if (event.event !== 'script' && event.event !== 'loadedSource') {
                    done(new Error('An unexpected event was fired: ' + event.event));
                }
            };

            chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                emitScriptParsed('http://localhost', 4);
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
                    const urlRegex = utils.pathToRegex(url, true);
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

            const expectedRegex = utils.pathToRegex(FILE_NAME, true);
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
                .then(() => chromeDebugAdapter.setBreakpoints({ source: { path: 'VM' + SCRIPT_ID }, breakpoints }, 0))
                .then(response => assertExpectedResponse(response, breakpoints));
        });
    });

    suite('Console.messageAdded', () => {
        test('Fires an output event when a console message is added', done => {
            const testLog = 'Hello, world!';
            sendEventHandler = (event: DebugProtocol.Event) => {
                if (event.event === 'output') {
                    assert.equal(event.body.output.trim(), testLog);
                    done();
                } else {
                    testUtils.assertFail('An unexpected event was fired');
                }
            };

            chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                mockEventEmitter.emit('Console.messageAdded', {
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
    });

    suite('Runtime.consoleAPICalled', () => {
        test('Fires an output event when a console api is called', done => {
            const testLog = 'Hello, world!';
            sendEventHandler = (event: DebugProtocol.Event) => {
                if (event.event === 'output') {
                    assert.equal(event.body.output.trim(), testLog);
                    done();
                } else {
                    testUtils.assertFail('An unexpected event was fired');
                }
            };

            chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                mockEventEmitter.emit('Runtime.consoleAPICalled', {
                    type: 'log',
                    args: [{
                        type: 'string',
                        value: testLog
                    }],
                    executionContextId: 1,
                    timestamp: 1754079033.244016
                });
            });
        });
    });

    suite('Debugger.scriptParsed', () => {
        const FILE_NAME = 'file:///a.js';
        const SCRIPT_ID = '1';
        function emitScriptParsed(url = FILE_NAME, scriptId = SCRIPT_ID, otherArgs: any = {}): void {
            mockSourceMapTransformer.setup(m => m.scriptParsed(It.isValue(undefined), It.isValue(undefined)))
                .returns(() => Promise.resolve([]));
            otherArgs.url = url;
            otherArgs.scriptId = scriptId;

            mockEventEmitter.emit('Debugger.scriptParsed', otherArgs);
        }

        test('adds default url when missing', done => {
            chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                mockPathTransformer.setup(m => m.scriptParsed(It.isAnyString()))
                    .returns(url => {
                        assert(!!url, 'Default url missing'); // Should be called with some default url
                        return url;
                    });
                mockSourceMapTransformer.setup(m => m.scriptParsed(It.isAny(), It.isValue(undefined)))
                    .returns(() => {
                        done();
                        return Promise.resolve([]);
                    });

                emitScriptParsed(/*url=*/'');
            });
        });

        // This is needed for Edge debug adapter, please keep the signature and logic of sendLoadedSourceEvent() method intact.
        test('tests that sendLoadedSourceEvent can accept an additional paramter to override the `reason` parameter', () => {
            const loadedSourceEventReason: LoadedSourceEventReason = 'changed';
            sendEventHandler = (event) => {
                assert.equal('loadedSource', event.event);
                assert.notEqual(null, event.body);
                assert.equal(loadedSourceEventReason, event.body.reason);
            };

            return chromeDebugAdapter.attach(ATTACH_ARGS).then(() => {
                return (<any>chromeDebugAdapter).sendLoadedSourceEvent({
                    scriptId: 1,
                    url: '',
                    startLine: 0,
                    startColumn: 0,
                    endLine: 0,
                    endColumn: 0,
                    executionContextId: 0,
                    hash: ''
                }, loadedSourceEventReason);
            });
        });

        function createSource(name: string, path?: string, sourceReference?: number, origin?: string): Source {
            return <Source>{
                name: name,
                path: path,
                // if the path exists, do not send the sourceReference
                sourceReference: sourceReference,
                origin
            };
        }

        test('When a page refreshes, finish sending the "new" source events, before sending the corresponding "removed" source event', async () => {
            const expectedEvents: DebugProtocol.Event[] = [
                new InitializedEvent(),
                new LoadedSourceEvent('new', createSource("about:blank", "about:blank", 1000)),
                new LoadedSourceEvent('removed', createSource("about:blank", "about:blank", 1000)),
                new LoadedSourceEvent('new', createSource("localhost:61312", "http://localhost:61312/", 1001))
              ];

              const receivedEvents: DebugProtocol.Event[] = [];
              sendEventHandler = (event: DebugProtocol.Event) => { receivedEvents.push(event); };

            await chromeDebugAdapter.attach(ATTACH_ARGS);
            emitScriptParsed('about:blank', "1");

            mockEventEmitter.emit('Debugger.globalObjectCleared');
            mockEventEmitter.emit('Runtime.executionContextsCleared');
            emitScriptParsed('http://localhost:61312/', "2");

            await chromeDebugAdapter.doAfterProcessingSourceEvents(() => {
                assert.deepEqual(receivedEvents, expectedEvents);
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
                namedVariables: undefined,
                type: resultObj.type
            };
        }

        function setupEvalMock(expression: string, result: Crdp.Runtime.RemoteObject): void {
            mockChrome.Runtime
                .setup(x => x.evaluate(It.isValue(<Crdp.Runtime.EvaluateRequest>{ expression, silent: true, generatePreview: true, includeCommandLineAPI: true, objectGroup: 'console', userGesture: true })))
                .returns(() => Promise.resolve(<Crdp.Runtime.EvaluateResponse>{ result }));
        }

        function setupEvalOnCallFrameMock(expression: string, callFrameId: string, result: Crdp.Runtime.RemoteObject): void {
            mockChrome.Debugger
                .setup(x => x.evaluateOnCallFrame(It.isValue({ expression, callFrameId, silent: true, generatePreview: true, includeCommandLineAPI: true, objectGroup: 'console' })))
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
        test('returns the same sourceReferences for the same scripts', async () => {
            await chromeDebugAdapter.attach(ATTACH_ARGS);

            const scriptId = 'script1';
            const location: Crdp.Debugger.Location = { lineNumber: 0, columnNumber: 0, scriptId };
            const callFrame = { callFrameId: 'id1', location };
            emitScriptParsed('', scriptId);
            mockEventEmitter.emit('Debugger.paused', <Crdp.Debugger.PausedEvent>{ callFrames: [callFrame, callFrame] });

            const { stackFrames } = await chromeDebugAdapter.stackTrace({ threadId: THREAD_ID });

            // Should have two stack frames with the same sourceReferences
            assert.equal(stackFrames.length, 2);
            assert.equal(stackFrames[0].source.sourceReference, stackFrames[1].source.sourceReference);
            const sourceReference = stackFrames[0].source.sourceReference;

            // If it pauses a second time, and we request another stackTrace, should have the same result
            mockEventEmitter.emit('Debugger.paused', <Crdp.Debugger.PausedEvent>{callFrames: [callFrame, callFrame]});
            const { stackFrames: stackFrames2 } = await chromeDebugAdapter.stackTrace({ threadId: THREAD_ID });

            assert.equal(stackFrames2.length, 2);
            assert.equal(stackFrames2[0].source.sourceReference, sourceReference);
            assert.equal(stackFrames2[1].source.sourceReference, sourceReference);
        });
    });

    suite('onExceptionThrown', () => {
        const authoredPath = '/Users/me/error.ts';
        const generatedPath = 'http://localhost:9999/error.js';

        const getExceptionStr = (path, line) => 'Error: kaboom!\n' +
            `    at error (${path}:${line}:1)\n` +
            `    at ${path}:${line}:1`;

        const generatedExceptionStr = getExceptionStr(generatedPath, 6);
        const authoredExceptionStr = getExceptionStr(authoredPath, 12);

        const exceptionEvent: Crdp.Runtime.ExceptionThrownEvent = {
            "timestamp": 1490164925297,
            "exceptionDetails": {
                "exceptionId": 21,
                "text": "Uncaught",
                "lineNumber": 5,
                "columnNumber": 10,
                "url": "http://localhost:9999/error.js",
                "stackTrace": null,
                "exception": {
                    "type": "object",
                    "subtype": "error",
                    "className": "Error",
                    "description": generatedExceptionStr,
                    "objectId": "{\"injectedScriptId\":148,\"id\":1}"
                },
                "executionContextId": 148
            }
        };

        test('passes through exception when no source mapping present', async () => {
            await chromeDebugAdapter.attach(ATTACH_ARGS);
            const sendEventP = new Promise((resolve, reject) => {
                sendEventHandler = (event) =>
                    asyncAssert(() => assert.equal(event.body.output.trim(), generatedExceptionStr), resolve, reject);
            });

            mockEventEmitter.emit('Runtime.exceptionThrown', exceptionEvent);
            await sendEventP;
        });

        test('translates callstack to authored files via source mapping', async () => {
            // We need to reset mocks and re-initialize chromeDebugAdapter
            // because reset() creates a new instance of object
            mockSourceMapTransformer.reset();
            mockery.resetCache();
            mockery.registerMock('fs', { statSync: () => { } });
            initChromeDebugAdapter();

            await chromeDebugAdapter.attach(ATTACH_ARGS);
            const sendEventP = new Promise((resolve, reject) => {
                sendEventHandler = (event) =>
                    asyncAssert(() => assert.equal(event.body.output.trim(), authoredExceptionStr), resolve, reject);
            });

            mockSourceMapTransformer.setup(m => m.mapToAuthored(It.isValue(generatedPath), It.isAnyNumber(), It.isAnyNumber()))
                .returns(() => Promise.resolve({ source: authoredPath, line: 12, column: 1 }));

            mockEventEmitter.emit('Runtime.exceptionThrown', exceptionEvent);
            await sendEventP;
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
