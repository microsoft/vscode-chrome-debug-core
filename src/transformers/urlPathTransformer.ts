/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BasePathTransformer } from './basePathTransformer';

import { IPathMapping } from '../debugAdapterInterfaces';
import { logger } from 'vscode-debugadapter';
import * as ChromeUtils from '../chrome/chromeUtils';

import * as path from 'path';
import { newResourceIdentifierMap, IResourceIdentifier, parseResourceIdentifier } from '../chrome/internal/sources/resourceIdentifier';
import { injectable, inject } from 'inversify';
import { TYPES } from '../chrome/dependencyInjection.ts/types';
import { IConnectedCDAConfiguration } from '../chrome/client/chromeDebugAdapter/cdaConfiguration';

/**
 * Converts a local path from Code to a path on the target.
 */
@injectable()
export class UrlPathTransformer extends BasePathTransformer {
    private _pathMapping: IPathMapping | undefined;
    private _clientPathToTargetUrl = newResourceIdentifierMap<IResourceIdentifier>();
    private _targetUrlToClientPath = newResourceIdentifierMap<IResourceIdentifier>();

    constructor(@inject(TYPES.ConnectedCDAConfiguration) configuration: IConnectedCDAConfiguration) {
        super();
        this._pathMapping = configuration.args.pathMapping;
    }

    public clearTargetContext(): void {
        this._clientPathToTargetUrl = newResourceIdentifierMap<IResourceIdentifier>();
        this._targetUrlToClientPath = newResourceIdentifierMap<IResourceIdentifier>();
    }

    public async scriptParsed(scriptUrl: IResourceIdentifier): Promise<IResourceIdentifier> {
        const clientPath = await this.targetUrlToClientPath(scriptUrl);

        if (clientPath.canonicalized === '') {
            // It's expected that eval scripts (eval://) won't be resolved
            if (!scriptUrl.canonicalized.startsWith(ChromeUtils.EVAL_NAME_PREFIX)) {
                logger.log(`Paths.scriptParsed: could not resolve ${scriptUrl} to a file with pathMapping/webRoot: ${JSON.stringify(this._pathMapping)}. It may be external or served directly from the server's memory (and that's OK).`);
            }
        } else {
            logger.log(`Paths.scriptParsed: resolved ${scriptUrl} to ${clientPath}. pathMapping/webroot: ${JSON.stringify(this._pathMapping)}`);
            const canonicalizedClientPath = clientPath;

            // an HTML file with multiple script tags will call this method several times with the same scriptUrl, so we use setAndReplaceIfExist
            this._clientPathToTargetUrl.setAndReplaceIfExists(canonicalizedClientPath, scriptUrl);
            this._targetUrlToClientPath.setAndReplaceIfExists(scriptUrl, clientPath);

            scriptUrl = clientPath;
        }

        return Promise.resolve(scriptUrl);
    }

    public getTargetPathFromClientPath(clientPath: IResourceIdentifier): IResourceIdentifier {
        // If it's already a URL, skip the Map
        return path.isAbsolute(clientPath.canonicalized) ?
            this._clientPathToTargetUrl.get(clientPath) :
            clientPath;
    }

    public getClientPathFromTargetPath(targetPath: IResourceIdentifier): IResourceIdentifier | undefined {
        return this._targetUrlToClientPath.tryGetting(targetPath);
    }

    /**
     * Overridable for VS to ask Client to resolve path
     */
    protected async targetUrlToClientPath(scriptUrl: IResourceIdentifier): Promise<IResourceIdentifier> {
        return Promise.resolve(parseResourceIdentifier(ChromeUtils.targetUrlToClientPath(scriptUrl.canonicalized, this._pathMapping)));
    }
}
