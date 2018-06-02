/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';

import { ChromeDebugSession } from '../chrome/chromeDebugSession';
import { IDebugTransformer, ISetBreakpointsResponseBody, IStackTraceResponseBody, IScopesResponseBody } from '../debugAdapterInterfaces';

/**
 * Converts from 1 based lines/cols on the client side to 0 based lines/cols on the target side
 */
export class LineColTransformer implements IDebugTransformer  {
    columnBreakpointsEnabled: boolean;

    constructor(private _session: ChromeDebugSession) {
    }

    public setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): DebugProtocol.SetBreakpointsArguments {
        args.breakpoints.forEach(bp => this.convertClientLocationToDebugger(bp));
        if (!this.columnBreakpointsEnabled) {
            args.breakpoints.forEach(bp => bp.column = undefined);
        }

        return args;
    }

    public setBreakpointsResponse(response: ISetBreakpointsResponseBody): void {
        response.breakpoints.forEach(bp => this.convertDebuggerLocationToClient(bp));
        if (!this.columnBreakpointsEnabled) {
            response.breakpoints.forEach(bp => bp.column = 1);
        }
    }

    public stackTraceResponse(response: IStackTraceResponseBody): void {
        response.stackFrames.forEach(frame => this.convertDebuggerLocationToClient(frame));
    }

    public breakpointResolved(bp: DebugProtocol.Breakpoint): void {
        this.convertDebuggerLocationToClient(bp);
        if (!this.columnBreakpointsEnabled) {
            bp.column = undefined;
        }
    }

    public scopeResponse(scopeResponse: IScopesResponseBody): void {
        scopeResponse.scopes.forEach(scope => this.mapScopeLocations(scope));
    }

    public mappedExceptionStack(location: { line: number; column: number }): void {
        this.convertDebuggerLocationToClient(location);
    }

    private mapScopeLocations(scope: DebugProtocol.Scope): void {
        this.convertDebuggerLocationToClient(scope);

        if (typeof scope.endLine === 'number') {
            const endScope = { line: scope.endLine, column: scope.endColumn };
            this.convertDebuggerLocationToClient(endScope);
            scope.endLine = endScope.line;
            scope.endColumn = endScope.column;
        }
    }

    public convertClientLocationToDebugger(location: { line?: number; column?: number }): void {
        if (typeof location.line === 'number') {
            location.line = this.convertClientLineToDebugger(location.line);
        }

        if (typeof location.column === 'number') {
            location.column = this.convertClientColumnToDebugger(location.column);
        }
    }

    public convertDebuggerLocationToClient(location: { line?: number; column?: number }): void {
        if (typeof location.line === 'number') {
            location.line = this.convertDebuggerLineToClient(location.line);
        }

        if (typeof location.column === 'number') {
            location.column = this.convertDebuggerColumnToClient(location.column);
        }
    }

    public convertClientLineToDebugger(line: number): number {
        return (<any>this._session).convertClientLineToDebugger(line);
    }

    public convertDebuggerLineToClient(line: number): number {
        return (<any>this._session).convertDebuggerLineToClient(line);
    }

    public convertClientColumnToDebugger(column: number): number {
        return (<any>this._session).convertClientColumnToDebugger(column);
    }

    public convertDebuggerColumnToClient(column: number): number {
        return (<any>this._session).convertDebuggerColumnToClient(column);
    }
}
