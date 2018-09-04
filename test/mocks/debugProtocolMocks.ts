/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/* tslint:disable:typedef */

import { EventEmitter } from 'events';
import { Mock, IMock } from 'typemoq';
import { Protocol as Crdp } from 'devtools-protocol';

export interface IMockChromeConnectionAPI {
    apiObjects: Crdp.ProtocolApi;

    Console: IMock<Crdp.ConsoleApi>;
    Debugger: IMock<Crdp.DebuggerApi>;
    Runtime: IMock<Crdp.RuntimeApi>;
    Inspector: IMock<Crdp.InspectorApi>;
    Log: IMock<Crdp.LogApi>;

    mockEventEmitter: EventEmitter;
}

// See https://github.com/florinn/typemoq/issues/20
function getConsoleStubs(mockEventEmitter) {
    return {
        enable() { },
        on(eventName, handler) { mockEventEmitter.on(`Console.${eventName}`, handler); }
    };
}

function getDebuggerStubs(mockEventEmitter) {
    return {
        setBreakpoint() { },
        setBreakpointByUrl() { },
        removeBreakpoint() { },
        enable() { },
        evaluateOnCallFrame() { },
        setAsyncCallStackDepth() { },

        on(eventName, handler) { mockEventEmitter.on(`Debugger.${eventName}`, handler); }
    };
}

function getRuntimeStubs(mockEventEmitter) {
    return {
        enable() { },
        evaluate() { },

        on(eventName, handler) { mockEventEmitter.on(`Runtime.${eventName}`, handler); }
    };
}

function getInspectorStubs(mockEventEmitter) {
    return {
        on(eventName, handler) { mockEventEmitter.on(`Inspector.${eventName}`, handler); }
    };
}

function getLogStubs(mockEventEmitter) {
    return {
        enable() { return Promise.resolve(); },
        on(eventName, handler) { mockEventEmitter.on(`Log.${eventName}`, handler); }
    };
}

export function getMockChromeConnectionApi(): IMockChromeConnectionAPI {
    const mockEventEmitter = new EventEmitter();

    const mockConsole = Mock.ofInstance<Crdp.ConsoleApi>(<any>getConsoleStubs(mockEventEmitter));
    mockConsole.callBase = true;
    mockConsole
        .setup(x => x.enable())
        .returns(() => Promise.resolve());

    const mockDebugger = Mock.ofInstance<Crdp.DebuggerApi>(<any>getDebuggerStubs(mockEventEmitter));
    mockDebugger.callBase = true;
    mockDebugger
        .setup(x => x.enable())
        .returns(() => Promise.resolve(null));

    const mockRuntime = Mock.ofInstance<Crdp.RuntimeApi>(<any>getRuntimeStubs(mockEventEmitter));
    mockRuntime.callBase = true;
    mockRuntime
        .setup(x => x.enable())
        .returns(() => Promise.resolve());

    const mockInspector = Mock.ofInstance<Crdp.InspectorApi>(<any>getInspectorStubs(mockEventEmitter));
    mockInspector.callBase = true;

    const mockLog = Mock.ofInstance<Crdp.LogApi>(<any>getLogStubs(mockEventEmitter));
    mockLog.callBase = true;

    const chromeConnectionAPI: Crdp.ProtocolApi = <any>{
        Console: mockConsole.object,
        Debugger: mockDebugger.object,
        Runtime: mockRuntime.object,
        Inspector: mockInspector.object,
        Log: mockLog.object
    };

    return {
        apiObjects: chromeConnectionAPI,

        Console: mockConsole,
        Debugger: mockDebugger,
        Runtime: mockRuntime,
        Inspector: mockInspector,
        Log: mockLog,

        mockEventEmitter
    };
}
