import { IScript } from '../internal/scripts/script';

import { Crdp } from '../..';

export type integer = number;

/**
 * A new JavaScript Script has been parsed by the debugee and it's about to be executed
 */
export interface ScriptParsedEvent {
    readonly script: IScript;
    readonly url: string;
    readonly startLine: integer;
    readonly startColumn: integer;
    readonly endLine: integer;
    readonly endColumn: integer;
    readonly executionContextId: Crdp.Runtime.ExecutionContextId;
    readonly hash: string;
    readonly executionContextAuxData?: any;
    readonly isLiveEdit?: boolean;
    readonly sourceMapURL?: string;
    readonly hasSourceURL?: boolean;
    readonly isModule?: boolean;
    readonly length?: integer;
}
