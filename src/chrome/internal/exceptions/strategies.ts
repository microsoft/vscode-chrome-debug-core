export interface PauseOnExceptionsStrategy {

}

export class PauseOnUnhandledExceptions implements PauseOnExceptionsStrategy { }
export class PauseOnAllExceptions implements PauseOnExceptionsStrategy { }
export class DoNotPauseOnAnyExceptions implements PauseOnExceptionsStrategy { }

export interface PauseOnPromiseRejectionsStrategy {
    shouldPauseOnRejections(): boolean;
}

export class PauseOnAllRejections implements PauseOnPromiseRejectionsStrategy {
    public shouldPauseOnRejections(): boolean {
        return true;
    }
}

export class DoNotPauseOnAnyRejections implements PauseOnPromiseRejectionsStrategy {
    public shouldPauseOnRejections(): boolean {
        return false;
    }
}
