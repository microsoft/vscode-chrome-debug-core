/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';

import {ChromeDebugSession} from '../chrome/chromeDebugSession';
import {IDebugTransformer, ISetBreakpointsResponseBody, IStackTraceResponseBody, IScopesResponseBody} from '../debugAdapterInterfaces';

/**
 * Converts from 1 based lines/cols on the client side to 0 based lines/cols on the target side
 */
export class LineColTransformer implements IDebugTransformer  {
    constructor(private _session: ChromeDebugSession) {
    }

    public setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): void {
        args.breakpoints.forEach(bp => this.convertClientLocationToDebugger(bp));
    }

    public setBreakpointsResponse(response: ISetBreakpointsResponseBody): void {
        response.breakpoints.forEach(bp => this.convertDebuggerLocationToClient(bp));
    }

    public stackTraceResponse(response: IStackTraceResponseBody): void {
        response.stackFrames.forEach(frame => this.convertDebuggerLocationToClient(frame));
    }

    public breakpointResolved(bp: DebugProtocol.Breakpoint): void {
        this.convertDebuggerLocationToClient(bp);
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

    private convertClientLocationToDebugger(location: { line?: number; column?: number }): void {
        if (typeof location.line === 'number') {
            location.line = this.convertClientLineToDebugger(location.line);
        }

        if (typeof location.column === 'number') {
            location.column = this.convertClientColumnToDebugger(location.column);
        }
    }

    private convertDebuggerLocationToClient(location: { line?: number; column?: number }): void {
        if (typeof location.line === 'number') {
            location.line = this.convertDebuggerLineToClient(location.line);
        }

        if (typeof location.column === 'number') {
            location.column = this.convertDebuggerColumnToClient(location.column);
        }
    }

    // Should be stable but ...
    private convertClientLineToDebugger(line: number): number {
        return (<any>this._session).convertClientLineToDebugger(line);
    }

    private convertDebuggerLineToClient(line: number): number {
        return (<any>this._session).convertDebuggerLineToClient(line);
    }

    private convertClientColumnToDebugger(column: number): number {
        return (<any>this._session).convertClientColumnToDebugger(column);
    }

    private convertDebuggerColumnToClient(column: number): number {
        return (<any>this._session).convertDebuggerColumnToClient(column);
    }
}
