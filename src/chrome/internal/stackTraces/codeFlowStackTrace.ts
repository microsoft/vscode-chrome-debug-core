/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { CodeFlowFrame } from './callFrame';
import { IScript } from '../scripts/script';

/**
 * This class represents a stack trace that only has code flow information, but no state
 * (This is the information provided by the CDTP.Runtime domain and/or async stack traces)
 */
export class CodeFlowStackTrace {
    constructor(
        public readonly codeFlowFrames: CodeFlowFrame<IScript>[],
        public readonly description?: string,
        public readonly parent?: CodeFlowStackTrace) { }
}
