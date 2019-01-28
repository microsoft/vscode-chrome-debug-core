/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IEquivalenceComparable } from '../../utils/equivalence';

/**
 * These classes represents the different actions that a breakpoint can take when hit
 * Breakpoint: AlwaysPause
 * Conditional Breakpoint: ConditionalPause
 * Logpoint: LogMessage
 * Hit Count Breakpoint: PauseOnHitCount
 */
export interface IBPActionWhenHit extends IEquivalenceComparable {
    isEquivalentTo(bpActionWhenHit: IBPActionWhenHit): boolean;
    accept<T>(visitor: IBPActionWhenHitVisitor<T>): T;
}

export interface IBPActionWhenHitVisitor<T> {
    alwaysPause(alwaysPause: AlwaysPause): T;
    conditionalPause(conditionalPause: ConditionalPause): T;
    pauseOnHitCount(pauseOnHitCount: PauseOnHitCount): T;
    logMessage(logMessage: LogMessage): T;
}

abstract class BaseBPActionWhenHit {
    public abstract accept<T>(visitor: IBPActionWhenHitVisitor<T>): T;

    public isEquivalentTo(bpActionWhenHit: IBPActionWhenHit): boolean {
        return bpActionWhenHit.accept(new BPActionWhenHitIsEquivalentVisitor(this));
    }
}

class BPActionWhenHitIsEquivalentVisitor implements IBPActionWhenHitVisitor<boolean> {
    public alwaysPause(alwaysPause: AlwaysPause): boolean {
        return this.areSameClass(this._left, alwaysPause);
    }

    public conditionalPause(conditionalPause: ConditionalPause): boolean {
        return this.areSameClass(this._left, conditionalPause)
            && this._left.expressionOfWhenToPause === conditionalPause.expressionOfWhenToPause;
    }
    public pauseOnHitCount(pauseOnHitCount: PauseOnHitCount): boolean {
        return this.areSameClass(this._left, pauseOnHitCount)
            && this._left.pauseOnHitCondition === pauseOnHitCount.pauseOnHitCondition;
    }
    public logMessage(logMessage: LogMessage): boolean {
        return this.areSameClass(this._left, logMessage)
            && this._left.expressionToLog === logMessage.expressionToLog;
    }

    private areSameClass<T extends IBPActionWhenHit>(left: IBPActionWhenHit, right: T): left is T {
        return left.constructor === right.constructor;
    }

    constructor(private readonly _left: IBPActionWhenHit) { }
}

export class AlwaysPause extends BaseBPActionWhenHit {
    public accept<T>(visitor: IBPActionWhenHitVisitor<T>): T {
        return visitor.alwaysPause(this);
    }

    public toString(): string {
        return 'always pause';
    }
}

export class ConditionalPause extends BaseBPActionWhenHit {
    public accept<T>(visitor: IBPActionWhenHitVisitor<T>): T {
        return visitor.conditionalPause(this);
    }

    public toString(): string {
        return `pause if: ${this.expressionOfWhenToPause}`;
    }

    constructor(public readonly expressionOfWhenToPause: string) {
        super();
    }
}

export class PauseOnHitCount extends BaseBPActionWhenHit {
    public accept<T>(visitor: IBPActionWhenHitVisitor<T>): T {
        return visitor.pauseOnHitCount(this);
    }

    public toString(): string {
        return `pause when hits: ${this.pauseOnHitCondition}`;
    }

    constructor(public readonly pauseOnHitCondition: string) {
        super();
    }
}

export class LogMessage extends BaseBPActionWhenHit {
    public accept<T>(visitor: IBPActionWhenHitVisitor<T>): T {
        return visitor.logMessage(this);
    }

    public toString(): string {
        return `log: ${this.expressionToLog}`;
    }

    constructor(public readonly expressionToLog: string) {
        super();
    }
}
