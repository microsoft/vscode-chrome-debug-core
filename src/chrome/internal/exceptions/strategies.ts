/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export interface IPauseOnExceptionsStrategy {

}

export class PauseOnUnhandledExceptions implements IPauseOnExceptionsStrategy { }
export class PauseOnAllExceptions implements IPauseOnExceptionsStrategy { }
export class DoNotPauseOnAnyExceptions implements IPauseOnExceptionsStrategy { }

export interface IPauseOnPromiseRejectionsStrategy {
    shouldPauseOnRejections(): boolean;
}

export class PauseOnAllRejections implements IPauseOnPromiseRejectionsStrategy {
    public shouldPauseOnRejections(): boolean {
        return true;
    }
}

export class DoNotPauseOnAnyRejections implements IPauseOnPromiseRejectionsStrategy {
    public shouldPauseOnRejections(): boolean {
        return false;
    }
}
