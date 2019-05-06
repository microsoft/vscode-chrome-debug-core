/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';

import { IDebugTransformer, IScopesResponseBody, IStackTraceResponseBody } from '../debugAdapterInterfaces';
import { inject, injectable } from 'inversify';
import { TYPES } from '../chrome/dependencyInjection.ts/types';
import { ConnectedCDAConfiguration } from '../chrome/client/chromeDebugAdapter/cdaConfiguration';
import { isTrue } from '../chrome/utils/typedOperators';

/**
 * Converts from 1 based lines/cols on the client side to 0 based lines/cols on the target side
 */
@injectable()
export class LineColTransformer implements IDebugTransformer {
    private _clientToDebuggerLineNumberDifference: number; // Client line number - debugger line number. 0 if client line number is 0-based, 1 otherwise
    private _clientToDebuggerColumnsDifference: number; // Similar to line numbers

    constructor(@inject(TYPES.ConnectedCDAConfiguration) configuration: ConnectedCDAConfiguration) {
        this._clientToDebuggerLineNumberDifference = isTrue(configuration.clientCapabilities.linesStartAt1) ? 1 : 0;
        this._clientToDebuggerColumnsDifference = isTrue(configuration.clientCapabilities.columnsStartAt1) ? 1 : 0;
    }

    public stackTraceResponse(response: IStackTraceResponseBody): void {
        response.stackFrames.forEach(frame => this.convertDebuggerLocationToClient(frame));
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
