/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {OutputEvent} from 'vscode-debugadapter';

let sendEvent: (event: DebugProtocol.Event) => void;

export function reportEvent(name: string, data?: any): void {
    // https://github.com/Microsoft/vscode-debugadapter-node/pull/77
    const event = new OutputEvent(name, 'telemetry');
    (<DebugProtocol.OutputEvent>event).body.data = data;

    if (sendEvent) sendEvent(event);
}

export function setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void {
    sendEvent = _sendEvent;
}
