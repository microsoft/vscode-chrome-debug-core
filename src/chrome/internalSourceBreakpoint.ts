/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { CodeFlowStackTrace } from './internal/stackTraces/codeFlowStackTrace';
import { parseResourceIdentifier } from './internal/sources/resourceIdentifier';
import { createCDTPScriptUrl } from './internal/sources/resourceIdentifierSubtypes';
import { isNotEmpty, isNotNull } from './utils/typedOperators';

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

        if (isNotEmpty(breakpoint.logMessage)) {
            this.condition = logMessageToExpression(breakpoint.logMessage);
            if (isNotEmpty(breakpoint.condition)) {
                this.condition = `(${breakpoint.condition}) && ${this.condition}`;
            }
        } else if (isNotEmpty(breakpoint.condition)) {
            this.condition = breakpoint.condition;
        }
    }
}

function isLogpointStack(stackTrace: CodeFlowStackTrace | null): boolean {
    return isNotNull(stackTrace) && stackTrace.codeFlowFrames.length > 0
    && stackTrace.codeFlowFrames[0].script.runtimeSource.identifier.isEquivalentTo(parseResourceIdentifier(createCDTPScriptUrl(InternalSourceBreakpoint.LOGPOINT_URL)));
}

export function stackTraceWithoutLogpointFrame(stackTrace: CodeFlowStackTrace): CodeFlowStackTrace {
    if (isLogpointStack(stackTrace)) {
        return {
            ...stackTrace,
            codeFlowFrames: stackTrace.codeFlowFrames.slice(1)
        };
    }

    return stackTrace;
}

const LOGMESSAGE_VARIABLE_REGEXP = /{(.*?)}/g;

function logMessageToExpression(msg: string): string {
    msg = msg.replace('%', '%%');

    const args: string[] = [];
    let format = msg.replace(LOGMESSAGE_VARIABLE_REGEXP, (_match, group) => {
        const a = group.trim();
        if (a) {
            args.push(`(${a})`);
            return '%O';
        } else {
            return '';
        }
    });

    format = format.replace('\'', '\\\'');

    const argStr = args.length > 0 ? `, ${args.join(', ')}` : '';
    return `console.log('${format}'${argStr});\n//# sourceURL=${InternalSourceBreakpoint.LOGPOINT_URL}`;
}
