/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';

/** Error class which automatically extracts the localization key of the latest call to localize (So we can easily deduplicate errors on telemetry) */
export class LocalizedError extends Error {

    public constructor(public readonly errorCode: string, localizedMessage: string) {
        super(localizedMessage);
    }
}

const getLocalizeCalls: (() => nls.LocalizeFunc)[] = [];

export function registerGetLocalize(getLocalizeCallback: () => nls.LocalizeFunc): void {
    getLocalizeCalls.push(getLocalizeCallback); // Add to the list to replace with the correct locale after it gets configured
}

export function configureLocale(locale: string): void {
    nls.config({ locale: locale });
    getLocalizeCalls.forEach(eachCall => eachCall());
}
