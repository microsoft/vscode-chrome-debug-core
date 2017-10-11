/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import {logger} from 'vscode-debugadapter';

import * as fs from 'fs';
import { UrlPathTransformer } from './urlPathTransformer';
import { ChromeDebugSession} from '../chrome/chromeDebugSession';

/**
 * Converts a local path from Code to a path on the target. Uses the UrlPathTransforme logic and fallbacks to asking the client if neccesary
 */
export class FallbackToClientPathTransformer extends UrlPathTransformer {
    private static ASK_CLIENT_TO_MAP_URL_TO_FILE_PATH_TIMEOUT = 500;

    constructor(private _session: ChromeDebugSession) {
        super();
    }

    protected async targetUrlToClientPath(webRoot: string, scriptUrl: string): Promise<string> {
        // First try the default UrlPathTransformer transformation
        return super.targetUrlToClientPath(webRoot, scriptUrl).then(filePath => {
            // Check if the file returned by that transformation does exist
            return new Promise<boolean>((resolve, reject) => {
                try {
                    fs.access(filePath, (err) => {
                        resolve(err ? false : true);
                    });
                } catch (e) {
                    resolve(false);
                }
            }).then(doesFilePathExist => doesFilePathExist
                // If it does, we use that result
                ? filePath
                // If it doesn't, we ask the client to map it as a fallback
                : this.requestClientToMapURLToFilePath(scriptUrl).catch(rejection => {
                    logger.log("The fallback transformation failed due to: " + rejection);
                    return filePath;
                }));
        });
    }

    private async requestClientToMapURLToFilePath(url: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this._session.sendRequest("mapURLToFilePath", {url: url}, FallbackToClientPathTransformer.ASK_CLIENT_TO_MAP_URL_TO_FILE_PATH_TIMEOUT, response => {
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
