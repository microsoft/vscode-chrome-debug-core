/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import { logger } from 'vscode-debugadapter';
import * as errors from '../errors';
import { UrlPathTransformer } from '../transformers/urlPathTransformer';
import * as utils from '../utils';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();
import { IResourceIdentifier, parseResourceIdentifier } from '../chrome/internal/sources/resourceIdentifier';
import { inject } from 'inversify';
import { TYPES } from '../chrome/dependencyInjection.ts/types';
import { IConnectedCDAConfiguration } from '../chrome/client/chromeDebugAdapter/cdaConfiguration';
import { isNotEmpty, hasMatches } from '../chrome/utils/typedOperators';
import _ = require('lodash');

interface IRootsState {
    install(): Promise<void>;
    getClientPathFromTargetPath(remotePath: IResourceIdentifier): IResourceIdentifier;
    getTargetPathFromClientPath(localPath: IResourceIdentifier): IResourceIdentifier;
}

class BothRootsAreSet implements IRootsState {
    public constructor(
        public readonly _localRoot: string,
        public readonly _remoteRoot: string // Maybe validate that it's absolute, for either windows or unix
    ) { }

    public async install(): Promise<void> {
        // Validate that localRoot is absolute and exists
        if (!path.isAbsolute(this._localRoot)) {
            return Promise.reject(errors.attributePathRelative('localRoot', this._localRoot));
        }

        const exists = await utils.existsAsync(this._localRoot);
        if (!exists) {
            throw errors.attributePathNotExist('localRoot', this._localRoot);
        }
    }

    private shouldMapPaths(remotePath: IResourceIdentifier): boolean {
        // Map paths only if localRoot/remoteRoot are set, and the remote path is absolute on some system
        return path.posix.isAbsolute(remotePath.canonicalized) || path.win32.isAbsolute(remotePath.canonicalized);
    }

    public getClientPathFromTargetPath(remotePath: IResourceIdentifier): IResourceIdentifier {
        if (!this.shouldMapPaths(remotePath)) return parseResourceIdentifier('');

        const relPath = relative(this._remoteRoot, remotePath.canonicalized);
        let localPath = join(this._localRoot, relPath);

        localPath = utils.fixDriveLetterAndSlashes(localPath);
        logger.log(`Mapped remoteToLocal: ${remotePath} -> ${localPath}`);
        return parseResourceIdentifier(localPath);
    }

    public getTargetPathFromClientPath(localPath: IResourceIdentifier): IResourceIdentifier {
        if (!this.shouldMapPaths(localPath)) return localPath;

        const relPath = relative(this._localRoot, localPath.canonicalized);
        let remotePath = join(this._remoteRoot, relPath);

        remotePath = utils.fixDriveLetterAndSlashes(remotePath, /*uppercaseDriveLetter=*/true);
        logger.log(`Mapped localToRemote: ${localPath} -> ${remotePath}`);
        return parseResourceIdentifier(remotePath);
    }
}

class MissingRoots implements IRootsState {
    public async install(): Promise<void> {}

    public getClientPathFromTargetPath(_remotePath: IResourceIdentifier): IResourceIdentifier {
        return parseResourceIdentifier('');
    }

    public getTargetPathFromClientPath(localPath: IResourceIdentifier): IResourceIdentifier {
        return localPath;
    }
}

/**
 * Converts a local path from Code to a path on the target.
 */
export class RemotePathTransformer extends UrlPathTransformer {
    private readonly _state: IRootsState;

    constructor(@inject(TYPES.ConnectedCDAConfiguration) configuration: IConnectedCDAConfiguration) {
        super(configuration);
        const args = configuration.args;

        if (isNotEmpty(args.localRoot) !== isNotEmpty(args.remoteRoot)) {
            throw new Error(localize('localRootAndRemoteRoot', 'Both localRoot and remoteRoot must be specified.'));
        }

        this._state = isNotEmpty(args.localRoot) && isNotEmpty(args.remoteRoot)
            ? new BothRootsAreSet(args.localRoot, args.remoteRoot)
            : new MissingRoots();
    }

    public install(): Promise<void> {
        return this._state.install();
    }

    public async scriptParsed(scriptPath: IResourceIdentifier): Promise<IResourceIdentifier> {
        scriptPath = await super.scriptParsed(scriptPath);
        scriptPath = _.defaultTo(this.getClientPathFromTargetPath(scriptPath), scriptPath);

        return scriptPath;
    }

    public getClientPathFromTargetPath(remotePath: IResourceIdentifier): IResourceIdentifier {
        remotePath = _.defaultTo(this.getClientPathFromTargetPath(remotePath), remotePath);

        // Map as non-file-uri because remoteRoot won't expect a file uri
        remotePath = parseResourceIdentifier(utils.fileUrlToPath(remotePath.canonicalized));
        return this._state.getClientPathFromTargetPath(remotePath);
    }

    public getTargetPathFromClientPath(localPath: IResourceIdentifier): IResourceIdentifier {
        localPath = _.defaultTo(this.getTargetPathFromClientPath(localPath), localPath);
        return this._state.getTargetPathFromClientPath(localPath);
    }
}

/**
 * Cross-platform path.relative
 */
function relative(a: string, b: string): string {
    return hasMatches(a.match(/^[A-Za-z]:/)) ?
        path.win32.relative(a, b) :
        path.posix.relative(a, b);
}

/**
 * Cross-platform path.join
 */
function join(a: string, b: string): string {
    return hasMatches(a.match(/^[A-Za-z]:/)) ?
        path.win32.join(a, b) :
        utils.forceForwardSlashes(path.posix.join(a, b));
}
