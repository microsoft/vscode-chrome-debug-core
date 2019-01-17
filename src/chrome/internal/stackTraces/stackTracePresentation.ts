/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { IStackTracePresentationRow } from './stackTracePresentationRow';

/** The stack traces we sent to the client will be represented by this classes and it is a combination of:
 *    1. CallFrames with state information from the sync frames.
 *    2. CodeFlowFrames without state information from async frames.
 *    3. Labels that we use to separate and show the description of the async frames
 */
 export interface IStackTracePresentation {
    readonly stackFrames: IStackTracePresentationRow[];
    readonly totalFrames: number;
}
