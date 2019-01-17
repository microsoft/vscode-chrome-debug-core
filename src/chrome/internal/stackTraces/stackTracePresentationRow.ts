/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export type CallFramePresentationHint = 'normal' | 'label' | 'subtle';

// Row of a stack trace that we send to the client
export interface IStackTracePresentationRow {
    readonly presentationHint?: CallFramePresentationHint;
}

// Row of a stack trace that is a label e.g.: [Show more frames] or [Frames skipped by smartStep], etc...
export class StackTraceLabel implements IStackTracePresentationRow {
    public readonly presentationHint = 'label';

    constructor(public readonly description: string) { }
}
