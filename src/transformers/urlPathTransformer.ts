/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BasePathTransformer } from './basePathTransformer';

import { ISetBreakpointsArgs, ILaunchRequestArgs, IAttachRequestArgs, IStackTraceResponseBody, IPathMapping } from '../debugAdapterInterfaces';
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

    public setBreakpoints(args: ISetBreakpointsArgs): ISetBreakpointsArgs {
        if (!args.source.path) {
            // sourceReference script, nothing to do
            return args;
        }

        if (utils.isURL(args.source.path)) {
            // already a url, use as-is
            logger.log(`Paths.setBP: ${args.source.path} is already a URL`);
            return args;
        }

        const path = utils.canonicalizeUrl(args.source.path);
        const url = this.getTargetPathFromClientPath(path);
        if (url) {
            args.source.path = url;
            logger.log(`Paths.setBP: Resolved ${path} to ${args.source.path}`);
            return args;
        } else {
            logger.log(`Paths.setBP: No target url cached yet for client path: ${path}.`);
            args.source.path = path;
            return args;
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
        return Promise.resolve(ChromeUtils.targetUrlToClientPath(scriptUrl, this._pathMapping));
    }
}
