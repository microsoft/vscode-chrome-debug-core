/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();
import { LocalizedError, registerGetLocalize } from '../../utils/localizedError';
registerGetLocalize(() => localize = nls.loadMessageBundle());

import { Protocol as CDTP } from 'devtools-protocol';
import { IPauseOnExceptionsStrategy, PauseOnAllExceptions, PauseOnUnhandledExceptions, DoNotPauseOnAnyExceptions } from '../../internal/exceptions/strategies';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface IPauseOnExceptionsConfigurer {
    setPauseOnExceptions(strategy: IPauseOnExceptionsStrategy): Promise<void>;
}

export type ExceptionCategories = 'none' | 'uncaught' | 'all';

@injectable()
export class CDTPPauseOnExceptionsConfigurer implements IPauseOnExceptionsConfigurer {
    protected readonly api = this._protocolApi.Debugger;

    constructor(
        @inject(TYPES.CDTPClient)
        private readonly _protocolApi: CDTP.ProtocolApi) {
    }

    public setPauseOnExceptions(strategy: IPauseOnExceptionsStrategy): Promise<void> {
        let state: ExceptionCategories;

        if (strategy instanceof PauseOnAllExceptions) {
            state = 'all';
        } else if (strategy instanceof PauseOnUnhandledExceptions) {
            state = 'uncaught';
        } else if (strategy instanceof DoNotPauseOnAnyExceptions) {
            state = 'none';
        } else {
            throw new LocalizedError('error.pauseOnException.unknownStrategy', localize('error.pauseOnException.unknownStrategy', "Can't pause on exception using an unknown strategy {0}", strategy.toString()));
        }

        return this.api.setPauseOnExceptions({ state });
    }
}
