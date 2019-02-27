/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { Protocol as CDTP } from 'devtools-protocol';
import * as utils from '../../../utils';

export interface IBreakpointFeaturesSupport {
    supportsColumnBreakpoints: Promise<boolean>;
}

@injectable()
export class CDTPBreakpointFeaturesSupport implements IBreakpointFeaturesSupport {
    private result = utils.promiseDefer<boolean>();

    public supportsColumnBreakpoints = this.result.promise;

    constructor(
        @inject(TYPES.CDTPClient) private readonly api: CDTP.ProtocolApi) {
        api.Debugger.on('scriptParsed', params => this.onScriptParsed(params));
    }

    private async onScriptParsed(params: CDTP.Debugger.ScriptParsedEvent): Promise<void> {
        const scriptId = params.scriptId;

        try {
            await this.api.Debugger.getPossibleBreakpoints({
                start: { scriptId, lineNumber: 0, columnNumber: 0 },
                end: { scriptId, lineNumber: 1, columnNumber: 0 },
                restrictToFunction: false
            });

            this.result.resolve(true);
        } catch (e) {
            this.result.resolve(false);
        }
    }
}