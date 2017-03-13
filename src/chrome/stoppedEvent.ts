/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {StoppedEvent} from 'vscode-debugadapter';

import * as utils from '../utils';

export type ReasonType = 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'debugger_statement' | 'frame_entry' | 'promise_rejection';

export class StoppedEvent2 extends StoppedEvent {
    constructor(reason: ReasonType, threadId: number, exception_text?: string) {
        super(reason, threadId, exception_text);

        switch (reason) {
            case 'step':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.step', "Paused on step");
                break;
            case 'breakpoint':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.breakpoint', "Paused on breakpoint");
                break;
            case 'exception':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.exception', "Paused on exception");
                break;
            case 'pause':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.user_request', "Paused on user request");
                break;
            case 'entry':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.entry', "Paused on entry");
                break;
            case 'debugger_statement':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.debugger_statement', "Paused on debugger statement");
                break;
            case 'frame_entry':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.restart', "Paused on frame entry");
                break;
            case 'promise_rejection':
                (<DebugProtocol.StoppedEvent>this).body.description = utils.localize('reason.description.promiseRejection', "Paused on promise rejection");
                break;
        }
    }
}
