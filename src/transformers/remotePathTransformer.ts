/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { logger } from 'vscode-debugadapter';
import { ICommonRequestArgs } from '../debugAdapterInterfaces';
import * as errors from '../errors';
import { UrlPathTransformer } from '../transformers/urlPathTransformer';
import * as utils from '../utils';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();
import { IResourceIdentifier, parseResourceIdentifier } from '../chrome/internal/sources/resourceIdentifier';
import { inject } from 'inversify';
import { TYPES } from '../chrome/dependencyInjection.ts/types';
import { IConnectedCDAConfiguration } from '../chrome/client/chromeDebugAdapter/cdaConfiguration';

/**
 * Converts a local path from Code to a path on the target.
 */
export class RemotePathTransformer extends UrlPathTransformer {
    private _localRoot: string;
    private _remoteRoot: string;

    constructor(@inject(TYPES.ConnectedCDAConfiguration) configuration: IConnectedCDAConfiguration) {
        super(configuration);
        this.init(configuration.args);
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

    public async scriptParsed(scriptPath: IResourceIdentifier): Promise<IResourceIdentifier> {
        scriptPath = await super.scriptParsed(scriptPath);
        scriptPath = this.getClientPathFromTargetPath(scriptPath) || scriptPath;

        return scriptPath;
    }

    private shouldMapPaths(remotePath: IResourceIdentifier): boolean {
        // Map paths only if localRoot/remoteRoot are set, and the remote path is absolute on some system
        return !!this._localRoot && !!this._remoteRoot && (path.posix.isAbsolute(remotePath.canonicalized) || path.win32.isAbsolute(remotePath.canonicalized));
    }

    public getClientPathFromTargetPath(remotePath: IResourceIdentifier): IResourceIdentifier {
        remotePath = super.getClientPathFromTargetPath(remotePath) || remotePath;

        // Map as non-file-uri because remoteRoot won't expect a file uri
        remotePath = parseResourceIdentifier(utils.fileUrlToPath(remotePath.canonicalized));
        if (!this.shouldMapPaths(remotePath)) return parseResourceIdentifier('');

        const relPath = relative(this._remoteRoot, remotePath.canonicalized);
        let localPath = join(this._localRoot, relPath);

        localPath = utils.fixDriveLetterAndSlashes(localPath);
        logger.log(`Mapped remoteToLocal: ${remotePath} -> ${localPath}`);
        return parseResourceIdentifier(localPath);
    }

    public getTargetPathFromClientPath(localPath: IResourceIdentifier): IResourceIdentifier {
        localPath = super.getTargetPathFromClientPath(localPath) || localPath;
        if (!this.shouldMapPaths(localPath)) return localPath;

        const relPath = relative(this._localRoot, localPath.canonicalized);
        let remotePath = join(this._remoteRoot, relPath);

        remotePath = utils.fixDriveLetterAndSlashes(remotePath, /*uppercaseDriveLetter=*/true);
        logger.log(`Mapped localToRemote: ${localPath} -> ${remotePath}`);
        return parseResourceIdentifier(remotePath);
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
