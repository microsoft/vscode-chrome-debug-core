/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
import { LocalizeInfo } from 'vscode-nls';
import _ = require('lodash');

const originalConfig = nls.config;
let currentLocale: string | undefined = undefined;

/** We replace nls.config with our own version so we can know which locale is set, and force all the localize functions to be re-created when needed.
 * This works around the need to import all the secondary files only after the locale has been already set.
 */
(<any>nls).config = (opts?: nls.Options) => {
    currentLocale = _.defaultTo(opts, { locale: undefined }).locale;
    return originalConfig(opts);
};

const originalLoadMessageBundle = nls.loadMessageBundle;
/** We replace nls.loadMessageBundle with our own custom version, which will re-created the localize function after the locale has been changed.
 * This works around the need to import all the secondary files only after the locale has been already set.
 */
(<any>nls).loadMessageBundle = (file?: string) => {
    let localizeForFile = originalLoadMessageBundle(file);
    let localizeForFileLocale = currentLocale;
    return (key: string | LocalizeInfo, message: string, ...args: (string | number | boolean | undefined | null)[]) =>
        {
            // Has the locale changed since we created the localize function?
            if (localizeForFileLocale !== currentLocale) {
                localizeForFileLocale = currentLocale;
                // If so, re-create it so it'll use the new local (the localize caches the local, so we do need to re-create it after changing the locale)
                localizeForFile = originalLoadMessageBundle(file);
            }

            // Call our custom localize which will store the localization key for the LocaliedErrors
            return localizeForFile(<string>key, message, ...args);
        };
};

/** Error class which automatically extracts the localization key of the latest call to localize (So we can easily deduplicate errors on telemetry) */
export class LocalizedError extends Error {

    public constructor(public readonly errorCode: string, localizedMessage: string) {
        super(localizedMessage);
    }
}
