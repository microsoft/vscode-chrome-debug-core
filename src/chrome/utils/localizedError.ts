/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
import * as path from 'path';
import { LocalizeInfo, LocalizeFunc } from 'vscode-nls';
import _ = require('lodash');
import { readFileSync } from 'fs';
import { telemetry } from '../../telemetry';

// Store the key of the last call to localize, so we can inject it in the next LocalizedError we create
const defaultLastKeyOfLocalize = "last localization key couldn't be determined";
let lastKeyOfLocalize = defaultLastKeyOfLocalize;

/** We'll replace nls.loadMessageBundle to return this custom version of localize, which stores the last key used */
function customLocalize(file: string | undefined, localize: LocalizeFunc, info: LocalizeInfo, message: string, ...args: (string | number | boolean | undefined | null)[]): string;
function customLocalize(file: string | undefined, localize: LocalizeFunc, key: string | number, message: string, ...args: (string | number | boolean | undefined | null)[]): string;
function customLocalize(file: string | undefined, localize: LocalizeFunc, key: string | LocalizeInfo | number, message: string, ...args: (string | number | boolean | undefined | null)[]): string {
    lastKeyOfLocalize = extractLocalizationKey(key, file);

    return localize(<string>key, message, ...args);
}

/** Format of the bundle.json file */
interface LocalizationBundle {
    [file: string]: { keys: (string | undefined)[] } | undefined;
}

/** We store the bundle metadata on memory to be able to extract the localization keys based on the file and message index */
let bundle: LocalizationBundle = {};
const bundlePath = path.resolve(__dirname, '../../../nls.metadata.json');
const bundleFolderPath = path.dirname(bundlePath);
try {
    bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
} catch (exception) {
    telemetry.reportError('Failed to read bundle', exception);
}

/** Given the localization key, and the file, do our best effort to return the localization key (We get it from the bundle).
 * In dev we'll normally get the localization key as a string
 * In prod, the nls library replaces the key with a number which is the index in the bundle that has that particular message, so we need to use the file,
 * the index, and the bundle to find the localization key
 */
function extractLocalizationKey(key: string | number | nls.LocalizeInfo, file: string | undefined): string {
    if (typeof key === 'number') {
        if (file !== undefined) {
            const fileNormalizedPath = normalizeFilePath(file);
            const messagesForFile = bundle[fileNormalizedPath];
            if (messagesForFile !== undefined) {
                const textKey = messagesForFile.keys[key];
                if (textKey !== undefined) {
                    return textKey;
                }
            }
        }

        return `${file}:${key}`;
    } else if (typeof key === 'string') {
        return key;
    } else {
        return 'getNextLastKey parameter was unexpected';
    }
}

/** Normalize the file path to the format used in the localization bundles (Relative path, no extension, and forward slashes) */
function normalizeFilePath(file: string): string {
    const fileRelativePath = path.relative(bundleFolderPath, file);
    const normalizedPath = fileRelativePath.replace(/\\/g, '/').replace(/\.js$/g, '');
    return normalizedPath;
}

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
            return customLocalize(file, localizeForFile, <string>key, message, ...args);
        };
};

// Consume the key of the latest call to the localize function
function consumeLastLocalizationKey(): string {
    const lastKeyToReturn = lastKeyOfLocalize;
    lastKeyOfLocalize = defaultLastKeyOfLocalize;
    return lastKeyToReturn;
}

/** Error class which automatically extracts the localization key of the latest call to localize (So we can easily deduplicate errors on telemetry) */
export class LocalizedError extends Error {
    public readonly errorCode = consumeLastLocalizationKey();

    public constructor(localizedMessage: string) {
        super(localizedMessage);
    }
}