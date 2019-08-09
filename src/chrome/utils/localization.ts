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

/** Each file that calls localize = nls.loadMessageBundle() needs to call registerGetLocalize(() => localize = nls.loadMessageBundle()); too.
 * We call localize = nls.loadMessageBundle() when the file is parsed, which in most cases is before the DAP.initializeRequest which specifies the locale we need to
 * use in Visual Studio (In VS Code this works because it passes the locale in an environment variable).
 * So after we get the locale from Visual Studio, we need to re-create all the localize functions in all the program to use the right locale, so we use
 * registerGetLocalize to register all those places, and have all those locale functions recreated
 */
export function registerGetLocalize(getLocalizeCallback: () => nls.LocalizeFunc): void {
    getLocalizeCalls.push(getLocalizeCallback); // Add to the list to replace with the correct locale after it gets configured
}

export function configureLocale(locale: string): void {
    nls.config({ locale: locale });
    getLocalizeCalls.forEach(eachCall => eachCall());
}
