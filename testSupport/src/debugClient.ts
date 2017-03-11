/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

import { IAllLoadedScriptsResponseBody } from 'vscode-chrome-debug-core';
import { DebugClient } from 'vscode-debugadapter-testsupport';
import { DebugProtocol } from 'vscode-debugprotocol';

export const THREAD_ID = 1;

export function setBreakpointOnStart(dc: DebugClient, bps: DebugProtocol.SourceBreakpoint[], program: string, expLine?: number, expCol?: number, expVerified = true): Promise<void> {
    return dc.waitForEvent('initialized')
        .then(event => setBreakpoint(dc, bps, program, expLine, expCol, expVerified))
        .then(() => dc.configurationDoneRequest())
        .then(() => { });
}

export function setBreakpoint(dc: DebugClient, bps: DebugProtocol.SourceBreakpoint[], program: string, expLine?: number, expCol?: number, expVerified = true): Promise<void> {
    return dc.setBreakpointsRequest({
        breakpoints: bps,
        source: { path: program }
    }).then(response => {
        const bp = response.body.breakpoints[0];

        if (typeof expVerified === 'boolean') assert.equal(bp.verified, expVerified, 'breakpoint verification mismatch: verified');
        if (typeof expLine === 'number') assert.equal(bp.line, expLine, 'breakpoint verification mismatch: line');
        if (typeof expCol === 'number') assert.equal(bp.column, expCol, 'breakpoint verification mismatch: column');
    })
}

export interface IExpectedStopLocation {
    path?: string;
    line?: number;
    column?: number;
}

export class ExtendedDebugClient extends DebugClient {
    async toggleSkipFileStatus(aPath: string): Promise<DebugProtocol.Response> {
        const results = await Promise.all([
            this.send('toggleSkipFileStatus', { path: aPath }),
            this.waitForEvent('stopped')
        ]);

        return results[0];
    }

    async getLoadScripts(): Promise<IAllLoadedScriptsResponseBody> {
        const response = await this.send('getLoadScripts')
        return response.body;
    }

    continueRequest(): Promise<DebugProtocol.ContinueResponse> {
        return super.continueRequest({ threadId: THREAD_ID });
    }

    nextRequest(): Promise<DebugProtocol.NextResponse> {
        return super.nextRequest({ threadId: THREAD_ID });
    }

    stepOutRequest(): Promise<DebugProtocol.StepOutResponse> {
        return super.stepOutRequest({ threadId: THREAD_ID });
    }

    stepInRequest(): Promise<DebugProtocol.StepInResponse> {
        return super.stepInRequest({ threadId: THREAD_ID });
    }

    stackTraceRequest(): Promise<DebugProtocol.StackTraceResponse> {
        return super.stackTraceRequest({ threadId: THREAD_ID });
    }

    continueAndStop(): Promise<any> {
        return Promise.all([
            super.continueRequest({ threadId: THREAD_ID }),
            this.waitForEvent('stopped')
        ]);
    }

    nextAndStop(): Promise<any> {
        return Promise.all([
            super.nextRequest({ threadId: THREAD_ID }),
            this.waitForEvent('stopped')
        ]);
    }

    stepOutAndStop(): Promise<any> {
        return Promise.all([
            super.stepOutRequest({ threadId: THREAD_ID }),
            this.waitForEvent('stopped')
        ]);
    }

    stepInAndStop(): Promise<any> {
        return Promise.all([
            super.stepInRequest({ threadId: THREAD_ID }),
            this.waitForEvent('stopped')
        ]);
    }

    async continueTo(reason: string, expected: IExpectedStopLocation): Promise<DebugProtocol.StackTraceResponse> {
        const results = await Promise.all([
            this.continueRequest(),
            this.assertStoppedLocation(reason, expected)
        ]);

        return results[1];
    }

    async nextTo(reason: string, expected: IExpectedStopLocation): Promise<DebugProtocol.StackTraceResponse> {
        const results = await Promise.all([
            this.nextRequest(),
            this.assertStoppedLocation(reason, expected)
        ]);

        return results[1] as any;
    }

    async stepOutTo(reason: string, expected: IExpectedStopLocation): Promise<DebugProtocol.StackTraceResponse> {
        const results = await Promise.all([
            this.stepOutRequest(),
            this.assertStoppedLocation(reason, expected)
        ]);

        return results[1] as any;
    }

    async stepInTo(reason: string, expected: IExpectedStopLocation): Promise<DebugProtocol.StackTraceResponse> {
        const results = await Promise.all([
            this.stepInRequest(),
            this.assertStoppedLocation(reason, expected)
        ]);

        return results[1] as any;
    }

    waitForEvent(eventType: string): Promise<DebugProtocol.Event> {
        return super.waitForEvent(eventType);
    }
}