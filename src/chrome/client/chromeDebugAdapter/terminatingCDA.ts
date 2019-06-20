/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as sourceMapUtils from '../../../sourceMaps/sourceMapUtils';
import { inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { BaseCDAState } from './baseCDAState';
import { logger, TerminatedEvent } from 'vscode-debugadapter';
import { ISession } from '../session';
import { telemetry } from '../../../telemetry';
import { ChromeConnection } from '../../chromeConnection';
import { IRestartRequestArgs } from '../../../debugAdapterInterfaces';
import { IDebuggeeRunner, IDebuggeeLauncher } from '../../debugeeStartup/debugeeLauncher';
import { TerminatedCDA } from './terminatedCDA';

export enum TerminatingReason {
    DisconnectedFromWebsocket,
    ClientRequestedToDisconnect
}

export type TerminatingCDAProvider = (reason: TerminatingReason) => TerminatingCDA;
export class TerminatingCDA extends BaseCDAState {
    constructor(
        @inject(TYPES.ISession) protected readonly _session: ISession,
        @inject(TYPES.ChromeConnection) private readonly _chromeConnection: ChromeConnection,
        @inject(TYPES.TerminatingReason) private readonly _reason: TerminatingReason,
        @inject(TYPES.IDebuggeeRunner) public readonly _debuggeeRunner: IDebuggeeRunner,
        @inject(TYPES.IDebuggeeLauncher) public readonly _debuggeeLauncher: IDebuggeeLauncher,
    ) {
        super([], {});
    }

    /* __GDPR__
         "ClientRequest/disconnect" : {
             "${include}": [
                 "${IExecutionResultTelemetryProperties}",
                 "${DebugCommonProperties}"
             ]
         }
     */
    public async terminate(): Promise<TerminatedCDA> {
        telemetry.reportEvent('FullSessionStatistics/SourceMaps/Overrides', { aspNetClientAppFallbackCount: sourceMapUtils.getAspNetFallbackCount() });

        // TODO: Wait until we don't have any more requests in flight.
        // TODO: Figure out if we need to do the stops that are inside terminate session before or after the shutdown

        await this.terminateSession(this._reason === TerminatingReason.DisconnectedFromWebsocket ? 'Got disconnect request' : 'Disconnected from websocket');

        return new TerminatedCDA(this._session).install();
    }

    public async terminateSession(reason: string, restart?: IRestartRequestArgs): Promise<void> {
        // TODO: Review the order of calls in this method, and make sure it's the proper one
        logger.log(`Terminated: ${reason}`);

        logger.log(`Waiting for any pending steps or log messages.`);
        // TODO: Add logic so the client won't exist while there are actions in flight
        // await this._currentStep;
        // await this._currentLogMessage;
        logger.log(`Current step and log messages complete`);

        /* __GDPR__
           "debugStopped" : {
              "reason" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
              "${include}": [ "${DebugCommonProperties}" ]
           }
         */
        telemetry.reportEvent('debugStopped', { reason });

        if (this._chromeConnection.isAttached) {
            await this._debuggeeRunner.stop();
            await this._chromeConnection.close();
        }

        // TODO: Figure out when we shouldn't send a TerminatedEvent if (isTrue((<ILaunchRequestArgs>this._configuration.args).noDebug)) { }
        this._session.sendEvent(new TerminatedEvent(restart));
    }
}