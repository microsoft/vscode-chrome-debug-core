import { DebugProtocol } from 'vscode-debugprotocol';

export interface ISession {
    sendEvent(event: DebugProtocol.Event): void;
    shutdown(): void;
    sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void;
    convertClientLineToDebugger(line: number): number;
    convertDebuggerLineToClient(line: number): number;
    convertClientColumnToDebugger(column: number): number;
    convertDebuggerColumnToClient(column: number): number;
    dispatchRequest(request: DebugProtocol.Request): Promise<void>;
}

export abstract class WrappedSessionCommonLogic implements ISession {
    public dispatchRequest(request: DebugProtocol.Request): Promise<void> {
        return this._wrappedSession.dispatchRequest(request);
    }

    public sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {
        this._wrappedSession.sendRequest(command, args, timeout, cb);
    }

    public sendEvent(event: DebugProtocol.Event): void {
        this._wrappedSession.sendEvent(event);
    }

    public shutdown(): void {
        this._wrappedSession.shutdown();
    }

    public convertClientLineToDebugger(line: number): number {
        // LineColTransformer uses this protected method from the session
        return this._wrappedSession.convertClientLineToDebugger(line);
    }

    public convertClientColumnToDebugger(column: number): number {
        // LineColTransformer uses this protected method from the session
        return this._wrappedSession.convertClientColumnToDebugger(column);
    }

    public convertDebuggerLineToClient(line: number): number {
        // LineColTransformer uses this protected method from the session
        return this._wrappedSession.convertDebuggerLineToClient(line);
    }

    public convertDebuggerColumnToClient(column: number): number {
        // LineColTransformer uses this protected method from the session
        return this._wrappedSession.convertDebuggerColumnToClient(column);
    }

    constructor(protected readonly _wrappedSession: ISession) { }
}