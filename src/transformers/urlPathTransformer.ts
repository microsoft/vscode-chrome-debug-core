/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BasePathTransformer } from './basePathTransformer';

import { ILaunchRequestArgs, IAttachRequestArgs, IPathMapping } from '../debugAdapterInterfaces';
import { logger } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import * as ChromeUtils from '../chrome/chromeUtils';

import * as path from 'path';
import { newResourceIdentifierMap, IResourceIdentifier } from '../chrome/internal/sources/resourceIdentifier';
import { parseResourceIdentifier } from '..';

/**
 * Converts a local path from Code to a path on the target.
 */
export class UrlPathTransformer extends BasePathTransformer {
    private _pathMapping: IPathMapping;
    private _clientPathToTargetUrl = newResourceIdentifierMap<IResourceIdentifier>();
    private _targetUrlToClientPath = newResourceIdentifierMap<IResourceIdentifier>();

    public launch(args: ILaunchRequestArgs): Promise<void> {
        this._pathMapping = args.pathMapping;
        return super.launch(args);
    }

    public attach(args: IAttachRequestArgs): Promise<void> {
        this._pathMapping = args.pathMapping;
        return super.attach(args);
    }

    public clearTargetContext(): void {
        this._clientPathToTargetUrl = newResourceIdentifierMap<IResourceIdentifier>();
        this._targetUrlToClientPath = newResourceIdentifierMap<IResourceIdentifier>();
    }

    public async scriptParsed(scriptUrl: IResourceIdentifier): Promise<IResourceIdentifier> {
        const clientPath = await this.targetUrlToClientPath(scriptUrl);

        if (!clientPath) {
            // It's expected that eval scripts (eval://) won't be resolved
            if (!scriptUrl.canonicalized.startsWith(ChromeUtils.EVAL_NAME_PREFIX)) {
                logger.log(`Paths.scriptParsed: could not resolve ${scriptUrl} to a file with pathMapping/webRoot: ${JSON.stringify(this._pathMapping)}. It may be external or served directly from the server's memory (and that's OK).`);
            }
        } else {
            logger.log(`Paths.scriptParsed: resolved ${scriptUrl} to ${clientPath}. pathMapping/webroot: ${JSON.stringify(this._pathMapping)}`);
            const canonicalizedClientPath = clientPath;
            this._clientPathToTargetUrl.set(canonicalizedClientPath, scriptUrl);
            this._targetUrlToClientPath.set(scriptUrl, clientPath);

            scriptUrl = clientPath;
        }

        return Promise.resolve(scriptUrl);
    }

    public async fixSource(source: DebugProtocol.Source): Promise<void> {
        // TODO DIEGO: Delete this method
        if (source && source.path) {
            // Try to resolve the url to a path in the workspace. If it's not in the workspace,
            // just use the script.url as-is. It will be resolved or cleared by the SourceMapTransformer.
            const clientPath = this.getClientPathFromTargetPath(parseResourceIdentifier(source.path)) ||
                await this.targetUrlToClientPath(parseResourceIdentifier(source.path));

            // Incoming stackFrames have sourceReference and path set. If the path was resolved to a file in the workspace,
            // clear the sourceReference since it's not needed.
            if (clientPath) {
                source.path = clientPath.canonicalized;
                source.sourceReference = undefined;
                source.origin = undefined;
                source.name = path.basename(clientPath.canonicalized);
            }
        }
    }

    public getTargetPathFromClientPath(clientPath: IResourceIdentifier): IResourceIdentifier {
        // If it's already a URL, skip the Map
        return path.isAbsolute(clientPath.canonicalized) ?
            this._clientPathToTargetUrl.get(clientPath) :
            clientPath;
    }

    public getClientPathFromTargetPath(targetPath: IResourceIdentifier): IResourceIdentifier {
        return this._targetUrlToClientPath.tryGetting(targetPath);
    }

    /**
     * Overridable for VS to ask Client to resolve path
     */
    protected async targetUrlToClientPath(scriptUrl: IResourceIdentifier): Promise<IResourceIdentifier> {
        return Promise.resolve(parseResourceIdentifier(ChromeUtils.targetUrlToClientPath(scriptUrl.canonicalized, this._pathMapping)));
    }
}
