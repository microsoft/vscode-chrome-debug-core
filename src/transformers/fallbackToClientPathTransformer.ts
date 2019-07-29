/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { logger } from 'vscode-debugadapter';

import { UrlPathTransformer } from './urlPathTransformer';
import * as ChromeUtils from '../chrome/chromeUtils';
import { IResourceIdentifier, parseResourceIdentifier } from '../chrome/internal/sources/resourceIdentifier';
import { IConnectedCDAConfiguration } from '../chrome/client/chromeDebugAdapter/cdaConfiguration';
import { inject } from 'inversify';
import { TYPES } from '../chrome/dependencyInjection.ts/types';
import { isNotEmpty } from '../chrome/utils/typedOperators';

/**
 * Converts a local path from Code to a path on the target. Uses the UrlPathTransforme logic and fallbacks to asking the client if neccesary
 */
export class FallbackToClientPathTransformer extends UrlPathTransformer {
    private static ASK_CLIENT_TO_MAP_URL_TO_FILE_PATH_TIMEOUT = 500;
    private readonly _session = this.configuration.session;

    constructor(
        @inject(TYPES.ConnectedCDAConfiguration) private readonly configuration: IConnectedCDAConfiguration,
    ) {
        super(configuration);
    }

    protected async targetUrlToClientPath(scriptUrl: IResourceIdentifier): Promise<IResourceIdentifier> {
        // First try the default UrlPathTransformer transformation
        return super.targetUrlToClientPath(scriptUrl).then(filePath => {
                // If it returns a valid non empty file path then that should be a valid result, so we use that
                // If it's an eval script we won't be able to map it, so we also return that
                return (isNotEmpty(filePath.textRepresentation) || ChromeUtils.isEvalScript(scriptUrl))
                    ? filePath
                    // In any other case we ask the client to map it as a fallback, and return filePath if there is any failures
                    : this.requestClientToMapURLToFilePath(scriptUrl).catch(rejection => {
                        logger.log('The fallback transformation failed due to: ' + rejection);
                        return filePath;
                    });
        });
    }

    private async requestClientToMapURLToFilePath(url: IResourceIdentifier): Promise<IResourceIdentifier> {
        return new Promise<IResourceIdentifier>((resolve, reject) => {
            this._session.sendRequest('mapURLToFilePath', { url: url.textRepresentation }, FallbackToClientPathTransformer.ASK_CLIENT_TO_MAP_URL_TO_FILE_PATH_TIMEOUT, response => {
                if (response.success) {
                    const filePath: string | null = response.body.filePath;
                    logger.log(`The client responded that the url "${url}" maps to the file path "${filePath}"`);
                    resolve(filePath !== null ? parseResourceIdentifier(filePath) : url);
                } else {
                    reject(new Error(localize('error.fallbackToClientPathTransformer.mappingFailed', "The client responded that the url \"{0}\" couldn't be mapped to a file path due to: {1}", url.textRepresentation, response.message)));
                }
            });
        });
    }
}
