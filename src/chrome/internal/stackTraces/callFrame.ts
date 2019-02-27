/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Location } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { IScript } from '../scripts/script';
import { Protocol as CDTP } from 'devtools-protocol';
import { Scope } from './scopes';

/**
 * CDTP has two types of stack traces:
 * 1. CDTP.Runtime stack traces have only information about which code was executed, but not the state associated with it
 * 2. CDTP.Debugger stack traces which have all the information that CDTP.Runtime has, and it also includes state information
 *
 * We represent this by modeling the information that both contain in CodeFlowFrame and the information that only CDTP.Debugger
 * contains on CallFrame (which has an embedded CodeFlowFrame)
 */

export type ScriptOrLoadedSource = IScript | ILoadedSource;

/**
 * This class represents the code flow (which code was executed) of a call frame.
 * (This has similar properties as the stack traces from the CDTP.Runtime domain)
 */
export class CodeFlowFrame<TResource extends ScriptOrLoadedSource> {
    constructor(
        public readonly index: number,
        public readonly functionName: string | undefined,
        public readonly location: Location<TResource>) { }

    public get source(): TResource extends ILoadedSource ? TResource : never {
        return this.location.resource as any;
    }

    public get script(): TResource extends IScript ? TResource : never {
        return this.location.resource as any;
    }

    public get lineNumber(): number {
        return this.location.position.lineNumber;
    }

    public get columnNumber(): number {
        return this.location.position.columnNumber;
    }

    public toString(): string {
        return `${this.functionName} at ${this.location}`;
    }
}

/**
 * This interface represents both the code flow and the state of a call frame.
 * (This has similar properties as the stack traces from the CDTP.Debugger domain)
 */
export interface ICallFrame<TResource extends ScriptOrLoadedSource> {
    readonly index: number;
    readonly location: Location<TResource>;
    readonly lineNumber: number;
    readonly columnNumber: number;
    readonly codeFlow: CodeFlowFrame<TResource>;
    readonly scopeChain: Scope[];
    readonly frameThis?: CDTP.Runtime.RemoteObject;
    readonly returnValue?: CDTP.Runtime.RemoteObject;
}

export type CallFrame<TResource extends ScriptOrLoadedSource> =
    TResource extends ILoadedSource ? LoadedSourceCallFrame :
    TResource extends IScript ? ScriptCallFrame :
    ICallFrame<never>; // TODO: Figure out how to change this for never

abstract class BaseCallFrame<TResource extends ScriptOrLoadedSource> implements ICallFrame<TResource> {
    public abstract get scopeChain(): Scope[];
    public abstract get codeFlow(): CodeFlowFrame<TResource>;

    public get source(): TResource extends ILoadedSource ? TResource : never {
        return this.codeFlow.source;
    }

    public get location(): Location<TResource> {
        return this.codeFlow.location;
    }

    public get lineNumber(): number {
        return this.codeFlow.lineNumber;
    }

    public get columnNumber(): number {
        return this.codeFlow.columnNumber;
    }

    public get index(): number {
        return this.codeFlow.index;
    }

    public get functionName(): string {
        return this.codeFlow.functionName;
    }
}

export class ScriptCallFrame extends BaseCallFrame<IScript> {
    constructor(
        public readonly codeFlow: CodeFlowFrame<IScript>,
        public readonly scopeChain: Scope[],
        public readonly frameThis: CDTP.Runtime.RemoteObject,
        public readonly returnValue?: CDTP.Runtime.RemoteObject) {
        super();
    }

    public mappedToSource(): LoadedSourceCallFrame {
        const codeFlow = new CodeFlowFrame<ILoadedSource>(this.index, this.codeFlow.functionName, this.location.mappedToSource());
        return new LoadedSourceCallFrame(this, codeFlow);
    }

    public toString(): string {
        return `${this.codeFlow}`;
    }
}

export class LoadedSourceCallFrame extends BaseCallFrame<ILoadedSource> {
    constructor(
        public readonly unmappedCallFrame: ScriptCallFrame,
        public readonly codeFlow: CodeFlowFrame<ILoadedSource>) {
        super();
    }

    public get scopeChain(): Scope[] {
        return this.unmappedCallFrame.scopeChain;
    }

    public get frameThis(): CDTP.Runtime.RemoteObject {
        return this.unmappedCallFrame.frameThis;
    }

    public get returnValue(): CDTP.Runtime.RemoteObject {
        return this.unmappedCallFrame.returnValue;
    }
}
