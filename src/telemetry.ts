/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {OutputEvent} from 'vscode-debugadapter';

export interface ITelemetryReporter {
    reportEvent(name: string, data?: any): void;
    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void;
}

export class TelemetryReporter implements ITelemetryReporter {
    private _sendEvent: (event: DebugProtocol.Event) => void;

    reportEvent(name: string, data?: any): void {
        if (this._sendEvent) {
            const event = new OutputEvent(name, 'telemetry', data);
            this._sendEvent(event);
        }
    }

    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void {
        this._sendEvent = _sendEvent;
    }
}

export class NullTelemetryReporter implements ITelemetryReporter {
    reportEvent(name: string, data?: any): void {
        // no-op
    }

    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void {
        // no-op
    }

}

export const telemetry = new TelemetryReporter();