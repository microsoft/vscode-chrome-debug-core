/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as Crdp } from 'devtools-protocol';
import { DebugProtocol } from 'vscode-debugprotocol';

export class InternalSourceBreakpoint {
    static readonly LOGPOINT_URL = 'vscode.logpoint.js';

    readonly line: number;
    readonly column?: number;
    readonly condition?: string;
    readonly hitCondition?: string;

    constructor(breakpoint: DebugProtocol.SourceBreakpoint) {
        this.line = breakpoint.line;
        this.column = breakpoint.column;
        this.hitCondition = breakpoint.hitCondition;

        if (breakpoint.logMessage) {
            this.condition = logMessageToExpression(breakpoint.logMessage);
            if (breakpoint.condition) {
                this.condition = `(${breakpoint.condition}) && ${this.condition}`;
            }
        } else if (breakpoint.condition) {
            this.condition = breakpoint.condition;
        }
    }
}

function isLogpointMessage(m: Crdp.Runtime.ConsoleAPICalledEvent): boolean {
    return m.stackTrace && m.stackTrace.callFrames.length > 0 && m.stackTrace.callFrames[0].url === InternalSourceBreakpoint.LOGPOINT_URL;
}

export function stackTraceWithoutLogpointFrame(m: Crdp.Runtime.ConsoleAPICalledEvent): Crdp.Runtime.StackTrace {
    if (isLogpointMessage(m)) {
        return {
            ...m.stackTrace,
            callFrames: m.stackTrace.callFrames.slice(1)
        };
    }

    return m.stackTrace;
}

const LOGMESSAGE_VARIABLE_REGEXP = /{(.*?)}/g;

function logMessageToExpression(msg: string): string {
    msg = msg.replace('%', '%%');

    const args: string[] = [];
    let format = msg.replace(LOGMESSAGE_VARIABLE_REGEXP, (match, group) => {
        const a = group.trim();
        if (a) {
            args.push(`(${a})`);
            return '%O';
        } else {
            return '';
        }
    });

    format = format.replace('\'', '\\\'');

    const argStr = args.length ? `, ${args.join(', ')}` : '';
    return `console.log('${format}'${argStr});\n//# sourceURL=${InternalSourceBreakpoint.LOGPOINT_URL}`;
}
