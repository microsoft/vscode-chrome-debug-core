/*---------------------------------------------------------
* Copyright (C) Microsoft Corporation. All rights reserved.
*--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { logger } from 'vscode-debugadapter';
import { URI } from 'vscode-uri';
import * as path from 'path';

const remoteUriScheme = 'vscode-remote';
const remotePathComponent = '__vscode-remote-uri__';

const isWindows = process.platform === 'win32';
function getFsPath(uri: URI): string {
    const fsPath = uri.fsPath;
    return isWindows && !fsPath.match(/^[a-zA-Z]:/) ?
        fsPath.replace(/\\/g, '/') : // Hack - undo the slash normalization that URI does when windows is the current platform
        fsPath;
}

export function mapRemoteClientToInternalPath(remoteUri: string): string {
    if (remoteUri.startsWith(remoteUriScheme + ':')) {
        const uri = URI.parse(remoteUri);
        const uriPath = getFsPath(uri);
        const driveLetterMatch = uriPath.match(/^[A-Za-z]:/);
        let internalPath: string;
        if (!!driveLetterMatch) {
            internalPath = path.win32.join(driveLetterMatch[0], remotePathComponent, uriPath.substr(2));
        } else {
            internalPath = path.posix.join('/', remotePathComponent, uriPath);
        }

        logger.log(`remoteMapper: mapping remote uri ${remoteUri} to internal path: ${internalPath}`);
        return internalPath;
    } else {
        return remoteUri;
    }
}

export function mapInternalSourceToRemoteClient(source: DebugProtocol.Source, remoteAuthority: string | undefined): DebugProtocol.Source {
    if (source && source.path && isInternalRemotePath(source.path) && remoteAuthority) {
        const remoteUri = URI.file(source.path.replace(new RegExp(remotePathComponent + '[\\/\\\\]'), ''))
            .with({
                scheme: remoteUriScheme,
                authority: remoteAuthority
            });

        return {
            ...source,
            path: remoteUri.toString(),
            origin: undefined,
            sourceReference: undefined
        };
    } else {
        return source;
    }
}

export function isInternalRemotePath(path: string): boolean {
    return path.startsWith('/' + remotePathComponent) || !!path.match(new RegExp('[a-zA-Z]:[\\/\\\\]' + remotePathComponent));
}
