/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {Mock, MockBehavior} from 'typemoq';
import Crdp from 'chrome-remote-debug-protocol';

export interface IMockChromeConnectionAPI {
    apiObjects: Crdp.CrdpClient;

    Debugger: Mock<Crdp.DebuggerClient>;
    Runtime: Mock<Crdp.RuntimeClient>;
}

export function getMockChromeConnectionApi(): IMockChromeConnectionAPI {
    // See https://github.com/florinn/typemoq/issues/20
    const debuggerStubs = {
        setBreakpoint() { },
        setBreakpointByUrl() { },
        removeBreakpoint() { },
        enable() { },
        evaluateOnCallFrame() { }
    };

    let mockDebugger = Mock.ofInstance<Crdp.DebuggerClient>(<any>debuggerStubs, MockBehavior.Strict);
    mockDebugger
        .setup(x => x.enable())
        .returns(() => Promise.resolve());

    const runtimeStubs = {
        enable() { },
        evaluate() { }
    };
    let mockRuntime = Mock.ofInstance<Crdp.RuntimeClient>(<any>runtimeStubs, MockBehavior.Strict);
    mockRuntime
        .setup(x => x.enable())
        .returns(() => Promise.resolve());

    const chromeConnectionAPI: Crdp.CrdpClient = <any>{
        Debugger: mockDebugger.object,
        Runtime: mockRuntime.object
    };

    return {
        apiObjects: chromeConnectionAPI,

        Debugger: mockDebugger,
        Runtime: mockRuntime
    };
}
