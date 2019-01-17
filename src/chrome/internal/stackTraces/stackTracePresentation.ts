import { IStackTracePresentationRow } from './stackTracePresentationRow';

/** The stack traces we sent to the client will be represented by this classes and it is a combination of:
 *    1. CallFrames with state information from the sync frames.
 *    2. CodeFlowFrames without state information from async frames.
 *    3. Labels that we use to [Show more frames] or [Frames skipped by smartStep], etc...
 */
 export interface StackTracePresentation {
    readonly stackFrames: IStackTracePresentationRow[];
    readonly totalFrames: number;
}
