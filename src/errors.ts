/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

export const evalNotAvailableMsg = localize('eval.not.available', 'not available');
export const runtimeNotConnectedMsg = localize('not.connected', 'not connected to runtime');

export const noRestartFrame = localize('restartFrame.cannot', "Can't restart frame");

export class ErrorWithMessage extends Error implements DebugProtocol.Message {
    private _message: DebugProtocol.Message;

    constructor (message: DebugProtocol.Message) {
        super(message.format);
        this._message = message;
    }

    public get id(): number {
        return this._message.id;
    }
    public get format(): string {
        return this._message.format;
    }
    public get variables(): { [key: string]: string; } {
        return this._message.variables;
    }
    public get sendTelemetry(): boolean {
        return this._message.sendTelemetry;
    }
    public get showUser(): boolean {
        return this._message.showUser;
    }
    public get url(): string {
        return this._message.url;
    }
    public get urlLabel(): string {
        return this._message.urlLabel;
    }
}

export function attributePathNotExist(attribute: string, path: string): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2007,
        format: localize('attribute.path.not.exist', "Attribute '{0}' does not exist ('{1}').", attribute, '{path}'),
        variables: { path }
    });
}

/**
 * Error stating that a relative path should be absolute
 */
export function attributePathRelative(attribute: string, path: string): DebugProtocol.Message {
    return new ErrorWithMessage(withInfoLink(
        2008,
        localize('attribute.path.not.absolute', "Attribute '{0}' is not absolute ('{1}'); consider adding '{2}' as a prefix to make it absolute.", attribute, '{path}', '${workspaceFolder}/'),
        { path },
        20003
    ));
}

/**
 * Get error with 'More Information' link.
 */
export function withInfoLink(id: number, format: string, variables: any, infoId: number): DebugProtocol.Message {
    return new ErrorWithMessage({
        id,
        format,
        variables,
        showUser: true,
        url: 'http://go.microsoft.com/fwlink/?linkID=534832#_' + infoId.toString(),
        urlLabel: localize('more.information', 'More Information')
    });
}

export function setValueNotSupported(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2004,
        format: localize('setVariable.error', 'Setting value not supported')
    });
}

export function errorFromEvaluate(errMsg: string): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2025,
        format: errMsg
    });
}

export function sourceRequestIllegalHandle(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2027,
        format: 'sourceRequest error: illegal handle',
        sendTelemetry: true
    });
}

export function sourceRequestCouldNotRetrieveContent(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2026,
        format: localize('source.not.found', 'Could not retrieve content.')
    });
}

export function pathFormat(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2018,
        format: 'debug adapter only supports native paths',
        sendTelemetry: true
    });
}

export function runtimeConnectionTimeout(timeoutMs: number, errMsg: string): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2010,
        format: localize('VSND2010', 'Cannot connect to runtime process, timeout after {0} ms - (reason: {1}).', '{_timeout}', '{_error}'),
        variables: { _error: errMsg, _timeout: timeoutMs + '' }
    });
}

export function stackFrameNotValid(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2020,
        format: 'stack frame not valid',
        sendTelemetry: true
    });
}

export function noCallStackAvailable(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2023,
        format: localize('VSND2023', 'No call stack available.')
    });
}

export function invalidThread(threadId: number): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2030,
        format: 'Invalid thread {_thread}',
        variables: { _thread: threadId + '' },
        sendTelemetry: true
    });
}

export function exceptionInfoRequestError(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2031,
        format: 'exceptionInfoRequest error',
        sendTelemetry: true
    });
}

export function noStoredException(): DebugProtocol.Message {
    return new ErrorWithMessage({
        id: 2032,
        format: 'exceptionInfoRequest error: no stored exception',
        sendTelemetry: true
    });
}
