export interface IBPActionWhenHit {
    isEquivalent(bpActionWhenHit: IBPActionWhenHit): boolean;

    basedOnTypeDo<R>(actionBasedOnClass: {
        alwaysBreak?: (alwaysBreak: AlwaysBreak) => R,
        conditionalBreak?: (conditionalBreak: ConditionalBreak) => R,
        logMessage?: (logMessage: LogMessage) => R,
        breakOnSpecificHitCounts?: (breakOnSpecificHitCounts: BreakOnHitCount) => R
    }): R;

    isBreakOnHitCount(): this is BreakOnHitCount;
    isAlwaysBreak(): this is AlwaysBreak;
    isConditionalBreak(): this is ConditionalBreak;
    isLogMessage(): this is LogMessage;
}

export abstract class BasedOnTypeDoCommonLogic implements IBPActionWhenHit {
    public abstract isEquivalent(bpActionWhenHit: IBPActionWhenHit): boolean;

    basedOnTypeDo<R>(actionBasedOnClass: {
        alwaysBreak?: (alwaysBreak: AlwaysBreak) => R,
        conditionalBreak?: (conditionalBreak: ConditionalBreak) => R,
        logMessage?: (logMessage: LogMessage) => R,
        breakOnSpecificHitCounts?: (breakOnSpecificHitCounts: BreakOnHitCount) => R;
    }): R {
        if (this.isAlwaysBreak() && actionBasedOnClass.alwaysBreak) {
            return actionBasedOnClass.alwaysBreak(this);
        } else if (this.isConditionalBreak() && actionBasedOnClass.conditionalBreak) {
            return actionBasedOnClass.conditionalBreak(this);
        } else if (this.isBreakOnHitCount() && actionBasedOnClass.breakOnSpecificHitCounts) {
            return actionBasedOnClass.breakOnSpecificHitCounts(this);
        } else if (this.isLogMessage() && actionBasedOnClass.logMessage) {
            return actionBasedOnClass.logMessage(this);
        } else {
            throw new Error(`Unexpected case. The logic wasn't prepared to handle the specified breakpoint action when hit: ${this}`);
        }
    }

    public isAlwaysBreak(): this is AlwaysBreak {
        return false;
    }

    public isConditionalBreak(): this is ConditionalBreak {
        return false;
    }

    public isBreakOnHitCount(): this is BreakOnHitCount {
        return false;
    }

    public isLogMessage(): this is LogMessage {
        return false;
    }
}

export class AlwaysBreak extends BasedOnTypeDoCommonLogic implements IBPActionWhenHit {
    public isEquivalent(otherBPActionWhenHit: IBPActionWhenHit): boolean {
        return otherBPActionWhenHit.isAlwaysBreak();
    }

    public isAlwaysBreak(): this is AlwaysBreak {
        return true;
    }

    public toString(): string {
        return 'always break';
    }
}

export class ConditionalBreak extends BasedOnTypeDoCommonLogic implements IBPActionWhenHit {
    public isEquivalent(otherBPActionWhenHit: IBPActionWhenHit): boolean {
        return otherBPActionWhenHit.isConditionalBreak()
            && otherBPActionWhenHit.expressionOfWhenToBreak === this.expressionOfWhenToBreak;
    }

    public isConditionalBreak(): this is ConditionalBreak {
        return true;
    }

    public toString(): string {
        return `break if: ${this.expressionOfWhenToBreak}`;
    }

    constructor(public readonly expressionOfWhenToBreak: string) {
        super();
    }
}

export class BreakOnHitCount extends BasedOnTypeDoCommonLogic implements IBPActionWhenHit {
    public isEquivalent(otherBPActionWhenHit: IBPActionWhenHit): boolean {
        return otherBPActionWhenHit.isBreakOnHitCount()
            && otherBPActionWhenHit.pauseOnHitCondition === this.pauseOnHitCondition;
    }

    public isBreakOnHitCount(): this is BreakOnHitCount {
        return true;
    }

    public toString(): string {
        return `break when hits: ${this.pauseOnHitCondition}`;
    }

    constructor(public readonly pauseOnHitCondition: string) {
        super();
    }
}

export class LogMessage extends BasedOnTypeDoCommonLogic implements IBPActionWhenHit {
    public isEquivalent(otherBPActionWhenHit: IBPActionWhenHit): boolean {
        return otherBPActionWhenHit.isLogMessage()
            && otherBPActionWhenHit.expressionToLog === this.expressionToLog;
    }

    public isLogMessage(): this is LogMessage {
        return true;
    }

    public toString(): string {
        return `log: ${this.expressionToLog}`;
    }

    constructor(public readonly expressionToLog: string) {
        super();
    }
}
