/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
import { registerGetLocalize } from './localization';

let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

export class InternalError extends Error {
    public constructor(public readonly errorCode: string, public readonly errorDetails: string) {
        super(localize('error.internal', 'We are sorry. The debugger ran into an unexpected situation. Error Code: {0}', errorCode));
    }
}