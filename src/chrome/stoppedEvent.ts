/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { StoppedEvent } from 'vscode-debugadapter';

import { Protocol as Crdp } from 'devtools-protocol';
import * as utils from '../utils';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

export type ReasonType = 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'debugger_statement' | 'frame_entry' | 'promise_rejection';

export class StoppedEvent2 extends StoppedEvent {
    constructor(reason: ReasonType, threadId: number, exception?: Crdp.Runtime.RemoteObject) {
        const exceptionText = exception && exception.description && utils.firstLine(exception.description);
        super(reason, threadId, exceptionText);

        switch (reason) {
            case 'step':
                (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.step', 'Paused on step');
                break;
            case 'breakpoint':
                (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.breakpoint', 'Paused on breakpoint');
                break;
            case 'exception':
                const uncaught = exception && (<any>exception).uncaught; // Currently undocumented
                if (typeof uncaught === 'undefined') {
                    (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.exception', 'Paused on exception');
                } else if (uncaught) {
                    (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.uncaughtException', 'Paused on uncaught exception');
                } else {
                    (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.caughtException', 'Paused on caught exception');
                }
                break;
            case 'pause':
                (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.user_request', 'Paused on user request');
                break;
            case 'entry':
                (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.entry', 'Paused on entry');
                break;
            case 'debugger_statement':
                (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.debugger_statement', 'Paused on debugger statement');
                break;
            case 'frame_entry':
                (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.restart', 'Paused on frame entry');
                break;
            case 'promise_rejection':
                (<DebugProtocol.StoppedEvent>this).body.description = localize('reason.description.promiseRejection', 'Paused on promise rejection');
                this.body.reason = 'exception';
                break;
            default:
                (<DebugProtocol.StoppedEvent>this).body.description = 'Unknown pause reason';
                break;
        }
    }
}
