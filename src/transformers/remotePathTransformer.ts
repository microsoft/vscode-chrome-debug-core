/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { logger } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IAttachRequestArgs, ICommonRequestArgs, ILaunchRequestArgs, IStackTraceResponseBody } from '../debugAdapterInterfaces';
import * as errors from '../errors';
import { UrlPathTransformer } from '../transformers/urlPathTransformer';
import * as utils from '../utils';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

/**
 * Converts a local path from Code to a path on the target.
 */
export class RemotePathTransformer extends UrlPathTransformer {
    private _localRoot: string;
    private _remoteRoot: string;

    public async launch(args: ILaunchRequestArgs): Promise<void> {
        await super.launch(args);
        return this.init(args);
    }

    public async attach(args: IAttachRequestArgs): Promise<void> {
        await super.attach(args);
        return this.init(args);
    }

    private async init(args: ICommonRequestArgs): Promise<void> {
        if ((args.localRoot && !args.remoteRoot) || (args.remoteRoot && !args.localRoot)) {
            throw new Error(localize('localRootAndRemoteRoot', 'Both localRoot and remoteRoot must be specified.'));
        }

        // Maybe validate that it's absolute, for either windows or unix
        this._remoteRoot = args.remoteRoot;

        // Validate that localRoot is absolute and exists
        let localRootP = Promise.resolve();
        if (args.localRoot) {
            const localRoot = args.localRoot;
            if (!path.isAbsolute(localRoot)) {
                return Promise.reject(errors.attributePathRelative('localRoot', localRoot));
            }

            localRootP = new Promise<void>((resolve, reject) => {
                fs.exists(localRoot, exists => {
                    if (!exists) {
                        reject(errors.attributePathNotExist('localRoot', localRoot));
                    }

                    this._localRoot = localRoot;
                    resolve();
                });
            });
        }

        return localRootP;
    }

    public async scriptParsed(scriptPath: string): Promise<string> {
        if (!this.shouldMapPaths(scriptPath)) {
            scriptPath = await super.scriptParsed(scriptPath);
        }

        scriptPath = this.getClientPathFromTargetPath(scriptPath) || scriptPath;

        return scriptPath;
    }

    public async stackTraceResponse(response: IStackTraceResponseBody): Promise<void> {
        await Promise.all(response.stackFrames.map(stackFrame => this.fixSource(stackFrame.source)));
    }

    public async fixSource(source: DebugProtocol.Source): Promise<void> {
        await super.fixSource(source);

        const remotePath = source && source.path;
        if (remotePath) {
            const localPath = this.getClientPathFromTargetPath(remotePath) || remotePath;
            if (utils.existsSync(localPath)) {
                source.path = localPath;
                source.sourceReference = undefined;
                source.origin = undefined;
            }
        }
    }

    private shouldMapPaths(remotePath: string): boolean {
        // Map paths only if localRoot/remoteRoot are set, and the remote path is absolute on some system
        return !!this._localRoot && !!this._remoteRoot && (path.posix.isAbsolute(remotePath) || path.win32.isAbsolute(remotePath) || utils.isFileUrl(remotePath));
    }

    public getClientPathFromTargetPath(remotePath: string): string {
        remotePath = super.getClientPathFromTargetPath(remotePath) || remotePath;

        // Map as non-file-uri because remoteRoot won't expect a file uri
        remotePath = utils.fileUrlToPath(remotePath);
        if (!this.shouldMapPaths(remotePath)) return '';

        const relPath = relative(this._remoteRoot, remotePath);
        if (relPath.startsWith('../')) return '';

        let localPath = join(this._localRoot, relPath);

        localPath = utils.fixDriveLetterAndSlashes(localPath);
        logger.log(`Mapped remoteToLocal: ${remotePath} -> ${localPath}`);
        return localPath;
    }

    public getTargetPathFromClientPath(localPath: string): string {
        localPath = super.getTargetPathFromClientPath(localPath) || localPath;
        if (!this.shouldMapPaths(localPath)) return localPath;

        const relPath = relative(this._localRoot, localPath);
        if (relPath.startsWith('../')) return '';

        let remotePath = join(this._remoteRoot, relPath);

        remotePath = utils.fixDriveLetterAndSlashes(remotePath, /*uppercaseDriveLetter=*/true);
        logger.log(`Mapped localToRemote: ${localPath} -> ${remotePath}`);
        return remotePath;
    }
}

/**
 * Cross-platform path.relative
 */
function relative(a: string, b: string): string {
    return a.match(/^[A-Za-z]:/) ?
        path.win32.relative(a, b) :
        path.posix.relative(a, b);
}

/**
 * Cross-platform path.join
 */
function join(a: string, b: string): string {
    return a.match(/^[A-Za-z]:/) ?
        path.win32.join(a, b) :
        utils.forceForwardSlashes(path.posix.join(a, b));
}
