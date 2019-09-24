/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BasePathTransformer } from './basePathTransformer';

import { ILaunchRequestArgs, IAttachRequestArgs, IStackTraceResponseBody, IPathMapping } from '../debugAdapterInterfaces';
import * as utils from '../utils';
import { logger } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import * as ChromeUtils from '../chrome/chromeUtils';

import * as path from 'path';

/**
 * Converts a local path from Code to a path on the target.
 */
export class UrlPathTransformer extends BasePathTransformer {
    private _pathMapping: IPathMapping;
    private _clientPathToTargetUrl = new Map<string, string>();
    private _targetUrlToClientPath = new Map<string, string>();

    public launch(args: ILaunchRequestArgs): Promise<void> {
        this._pathMapping = args.pathMapping;
        return super.launch(args);
    }

    public attach(args: IAttachRequestArgs): Promise<void> {
        this._pathMapping = args.pathMapping;
        return super.attach(args);
    }

    public setBreakpoints(source: DebugProtocol.Source): DebugProtocol.Source {
        if (!source.path) {
            // sourceReference script, nothing to do
            return source;
        }

        if (utils.isURL(source.path)) {
            // already a url, use as-is
            logger.log(`Paths.setBP: ${source.path} is already a URL`);
            return source;
        }

        const path = utils.canonicalizeUrl(source.path);
        const url = this.getTargetPathFromClientPath(path);
        if (url) {
            source.path = url;
            logger.log(`Paths.setBP: Resolved ${path} to ${source.path}`);
            return source;
        } else {
            logger.log(`Paths.setBP: No target url cached yet for client path: ${path}.`);
            source.path = path;
            return source;
        }
    }

    public clearTargetContext(): void {
        this._clientPathToTargetUrl = new Map<string, string>();
        this._targetUrlToClientPath = new Map<string, string>();
    }

    public async scriptParsed(scriptUrl: string): Promise<string> {
        const clientPath = await this.targetUrlToClientPath(scriptUrl);

        if (!clientPath) {
            // It's expected that eval scripts (eval://) won't be resolved
            if (!scriptUrl.startsWith(ChromeUtils.EVAL_NAME_PREFIX)) {
                logger.log(`Paths.scriptParsed: could not resolve ${scriptUrl} to a file with pathMapping/webRoot: ${JSON.stringify(this._pathMapping)}. It may be external or served directly from the server's memory (and that's OK).`);
            }
        } else {
            logger.log(`Paths.scriptParsed: resolved ${scriptUrl} to ${clientPath}. pathMapping/webroot: ${JSON.stringify(this._pathMapping)}`);
            const canonicalizedClientPath = utils.canonicalizeUrl(clientPath);
            this._clientPathToTargetUrl.set(canonicalizedClientPath, scriptUrl);
            this._targetUrlToClientPath.set(scriptUrl, clientPath);

            scriptUrl = clientPath;
        }

        return Promise.resolve(scriptUrl);
    }

    public async stackTraceResponse(response: IStackTraceResponseBody): Promise<void> {
        await Promise.all(response.stackFrames.map(frame => this.fixSource(frame.source)));
    }

    public async fixSource(source: DebugProtocol.Source): Promise<void> {
        if (source && source.path) {
            // Try to resolve the url to a path in the workspace. If it's not in the workspace,
            // just use the script.url as-is. It will be resolved or cleared by the SourceMapTransformer.
            const clientPath = this.getClientPathFromTargetPath(source.path) ||
                await this.targetUrlToClientPath(source.path);

            // Incoming stackFrames have sourceReference and path set. If the path was resolved to a file in the workspace,
            // clear the sourceReference since it's not needed.
            if (clientPath) {
                source.path = clientPath;
                source.sourceReference = undefined;
                source.origin = undefined;
                source.name = path.basename(clientPath);
            }
        }
    }

    public getTargetPathFromClientPath(clientPath: string): string {
        // If it's already a URL, skip the Map
        return path.isAbsolute(clientPath) ?
            this._clientPathToTargetUrl.get(utils.canonicalizeUrl(clientPath)) :
            clientPath;
    }

    public getClientPathFromTargetPath(targetPath: string): string {
        return this._targetUrlToClientPath.get(targetPath);
    }

    /**
     * Overridable for VS to ask Client to resolve path
     */
    protected async targetUrlToClientPath(scriptUrl: string): Promise<string> {
        return ChromeUtils.targetUrlToClientPath(scriptUrl, this._pathMapping);
    }
}
