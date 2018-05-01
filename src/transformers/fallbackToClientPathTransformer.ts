/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { logger } from 'vscode-debugadapter';

import { UrlPathTransformer } from './urlPathTransformer';
import { ChromeDebugSession } from '../chrome/chromeDebugSession';
import * as ChromeUtils from '../chrome/chromeUtils';

/**
 * Converts a local path from Code to a path on the target. Uses the UrlPathTransforme logic and fallbacks to asking the client if neccesary
 */
export class FallbackToClientPathTransformer extends UrlPathTransformer {
    private static ASK_CLIENT_TO_MAP_URL_TO_FILE_PATH_TIMEOUT = 500;

    constructor(private _session: ChromeDebugSession) {
        super();
    }

    protected async targetUrlToClientPath(scriptUrl: string): Promise<string> {
        // First try the default UrlPathTransformer transformation
        return super.targetUrlToClientPath(scriptUrl).then(filePath => {
                // If it returns a valid non empty file path then that should be a valid result, so we use that
                // If it's an eval script we won't be able to map it, so we also return that
                return (filePath || ChromeUtils.isEvalScript(scriptUrl))
                    ? filePath
                    // In any other case we ask the client to map it as a fallback, and return filePath if there is any failures
                    : this.requestClientToMapURLToFilePath(scriptUrl).catch(rejection => {
                        logger.log('The fallback transformation failed due to: ' + rejection);
                        return filePath;
                    });
        });
    }

    private async requestClientToMapURLToFilePath(url: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this._session.sendRequest('mapURLToFilePath', {url: url}, FallbackToClientPathTransformer.ASK_CLIENT_TO_MAP_URL_TO_FILE_PATH_TIMEOUT, response => {
                if (response.success) {
                    logger.log(`The client responded that the url "${url}" maps to the file path "${response.body.filePath}"`);
                    resolve(response.body.filePath);
                } else {
                    reject(new Error(`The client responded that the url "${url}" couldn't be mapped to a file path due to: ${response.message}`));
                }
            });
        });
    }
}
