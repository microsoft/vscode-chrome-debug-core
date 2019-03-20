/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as CDTP } from 'devtools-protocol';
import { inject, injectable, multiInject } from 'inversify';
import { ChromeDebugLogic } from '../../chromeDebugAdapter';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ICommandHandlerDeclarer, CommandHandlerDeclaration, IServiceComponent } from '../../internal/features/components';
import { BaseCDAState } from './baseCDAState';
import { IDomainsEnabler } from '../../cdtpDebuggee/infrastructure/cdtpDomainsEnabler';
import { IRuntimeStarter } from '../../cdtpDebuggee/features/cdtpRuntimeStarter';
import { InitializedEvent } from 'vscode-debugadapter';
import { ISession } from '../session';

export type ConnectedCDAProvider = (protocolApi: CDTP.ProtocolApi) => ConnectedCDA;

@injectable()
export class ConnectedCDA extends BaseCDAState {
    public static SCRIPTS_COMMAND = '.scripts';

    constructor(
        @inject(TYPES.ChromeDebugLogic) private readonly _chromeDebugAdapter: ChromeDebugLogic,
        @inject(TYPES.IDomainsEnabler) private readonly _domainsEnabler: IDomainsEnabler,
        @inject(TYPES.IRuntimeStarter) private readonly _runtimeStarter: IRuntimeStarter,
        @inject(TYPES.ISession) private readonly _session: ISession,
        @multiInject(TYPES.IServiceComponent) private readonly _serviceComponents: IServiceComponent[],
        @multiInject(TYPES.ICommandHandlerDeclarer) requestHandlerDeclarers: ICommandHandlerDeclarer[]
    ) {
        super(requestHandlerDeclarers, {
            'initialize': () => { throw new Error('The debug adapter is already initialized. Calling initialize again is not supported.'); },
            'launch': () => { throw new Error("Can't launch  to a new target while connected to a previous target"); },
            'attach': () => { throw new Error("Can't attach to a new target while connected to a previous target"); }
        });
    }

    public async install(): Promise<this> {
        await super.install();
        await this._chromeDebugAdapter.install();
        await this._domainsEnabler.enableDomains(); // Enables all the domains that were registered

        for (const serviceComponent of this._serviceComponents) {
            await serviceComponent.install();
        }

        await this._runtimeStarter.runIfWaitingForDebugger();
        this._session.sendEvent(new InitializedEvent());
        return this;
    }
}
