/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';

import { IDebugTransformer, ISetBreakpointsResponseBody, IScopesResponseBody, IStackTraceResponseBody } from '../debugAdapterInterfaces';
import { ComponentConfiguration } from '../chrome/internal/features/feature';
import { inject, injectable } from 'inversify';
import { TYPES } from '../chrome/dependencyInjection.ts/types';

/**
 * Converts from 1 based lines/cols on the client side to 0 based lines/cols on the target side
 */
@injectable()
export class LineColTransformer implements IDebugTransformer {
    private columnBreakpointsEnabled: boolean;
    private _clientToDebuggerLineNumberDifference: number; // Client line number - debugger line number. 0 if client line number is 0-based, 1 otherwise
    private _clientToDebuggerColumnsDifference: number; // Similar to line numbers

    constructor(@inject(TYPES.ConnectedCDAConfiguration) configuration: ComponentConfiguration) {
        this._clientToDebuggerLineNumberDifference = configuration._clientCapabilities.linesStartAt1 ? 1 : 0;
        this._clientToDebuggerColumnsDifference = configuration._clientCapabilities.columnsStartAt1 ? 1 : 0;
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
        return line - this._clientToDebuggerLineNumberDifference;
    }

    public convertDebuggerLineToClient(line: number): number {
        return line + this._clientToDebuggerLineNumberDifference;
    }

    public convertClientColumnToDebugger(column: number): number {
        return column - this._clientToDebuggerColumnsDifference;
    }

    public convertDebuggerColumnToClient(column: number): number {
        return column + this._clientToDebuggerColumnsDifference;
    }
}
