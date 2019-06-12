/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Location } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { IScript } from '../scripts/script';
import { Protocol as CDTP } from 'devtools-protocol';
import { Scope } from './scopes';
import { printArray } from '../../collections/printing';

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
        public readonly functionName: string,
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
        return `${this.index}: ${this.functionName} at ${this.location}`;
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
    readonly state: ICallFrameState;
}

export type CallFrame<TResource extends ScriptOrLoadedSource, TState extends ICallFrameState> =
    TResource extends ILoadedSource ? LoadedSourceCallFrame<TState> :
    TResource extends IScript ? ScriptCallFrame<TState> :
    ICallFrame<never>; // TODO: Figure out how to change this for never

abstract class BaseCallFrame<TResource extends ScriptOrLoadedSource> implements ICallFrame<TResource> {
    public abstract get codeFlow(): CodeFlowFrame<TResource>;
    public abstract get state(): ICallFrameState;

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

    public toString(): string {
        return `${this.codeFlow} {${this.state}}`;
    }
}

export interface ICallFrameState {}

export class CallFrameWithState implements ICallFrameState {
    public constructor(
        public readonly scopeChain: Scope[],
        public readonly frameThis: CDTP.Runtime.RemoteObject,
        public readonly returnValue?: CDTP.Runtime.RemoteObject) {}

    public toString(): string {
        return printArray('Scopes', this.scopeChain);
    }
}

export class CallFrameWithoutState implements ICallFrameState {}

export class ScriptCallFrame<TState extends ICallFrameState> extends BaseCallFrame<IScript> {
    constructor(
        public readonly codeFlow: CodeFlowFrame<IScript>,
        public readonly state: TState) {
        super();
    }

    public mappedToSource(): LoadedSourceCallFrame<TState> {
        const codeFlow = new CodeFlowFrame<ILoadedSource>(this.index, this.codeFlow.functionName, this.location.mappedToSource());
        return new LoadedSourceCallFrame(this, codeFlow);
    }

    public toString(): string {
        return `${this.codeFlow}`;
    }
}

export class LoadedSourceCallFrame<TState extends ICallFrameState> extends BaseCallFrame<ILoadedSource> {
    constructor(
        public readonly unmappedCallFrame: ScriptCallFrame<TState>,
        public readonly codeFlow: CodeFlowFrame<ILoadedSource>) {
        super();
    }

    public get state(): TState {
        return this.unmappedCallFrame.state;
    }

    public hasState(): this is LoadedSourceCallFrame<CallFrameWithState> {
        return this.state instanceof CallFrameWithState;
    }
}
