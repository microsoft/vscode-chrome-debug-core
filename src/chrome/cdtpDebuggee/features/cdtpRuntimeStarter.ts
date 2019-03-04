/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { Protocol as CDTP } from 'devtools-protocol';

export interface IRuntimeStarter {
    runIfWaitingForDebugger(): Promise<void>;
}

export class CDTPRuntimeStarter implements IRuntimeStarter {
    constructor(
        protected readonly api: CDTP.RuntimeApi) {
    }

    public async runIfWaitingForDebugger(): Promise<void> {
        // This is a CDTP version difference which will have to be handled more elegantly with others later...
        // For now, we need to send both messages and ignore a failing one.
        try {
            await Promise.all([
                this.api.runIfWaitingForDebugger(),
                (this.api as any).run()
            ]);
        } catch (exception) {
            // TODO: Make sure that at least one of the two calls succeeded
            // Ignore the failed call
        }
    }
}
