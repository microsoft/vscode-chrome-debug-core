/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';

export interface IDebugeeExecutionController {
    resume(): Promise<void>;
    pause(): Promise<void>;
}

@injectable()
export class CDTPDebugeeExecutionController implements IDebugeeExecutionController {
    constructor(
        @inject(TYPES.CDTPClient) protected readonly api: CDTP.ProtocolApi) {
    }

    public resume(): Promise<void> {
        return this.api.Debugger.resume();
    }

    public pause(): Promise<void> {
        return this.api.Debugger.pause();
    }
}
