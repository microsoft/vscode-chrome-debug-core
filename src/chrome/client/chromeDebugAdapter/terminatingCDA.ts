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
import { IRestartRequestArgs, ILaunchRequestArgs } from '../../../debugAdapterInterfaces';
import { ConnectedCDAConfiguration } from './cdaConfiguration';
import { DisconnectedCDA } from './disconnectedCDA';
import { IDebuggeeRunner, IDebuggeeLauncher } from '../../debugeeStartup/debugeeLauncher';
import { ScenarioType } from './unconnectedCDA';

export enum TerminatingReason {
    DisconnectedFromWebsocket,
    ClientRequestedToDisconnect
}

export type TerminatingCDAProvider = (reason: TerminatingReason) => TerminatingCDA;
export class TerminatingCDA extends BaseCDAState {
    constructor(
        @inject(TYPES.ISession) private readonly _session: ISession,
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
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
    public async disconnect(): Promise<DisconnectedCDA> {
        telemetry.reportEvent('FullSessionStatistics/SourceMaps/Overrides', { aspNetClientAppFallbackCount: sourceMapUtils.getAspNetFallbackCount() });

        // TODO: Wait until we don't have any more requests in flight.
        // TODO: Figure out if we need to do the stops before or after the shutdown and terminateSession
        await this._debuggeeRunner.stop();

        // don't call stop on the launcher if we attached
        if (this._configuration.scenarioType === ScenarioType.Launch) {
            await this._debuggeeLauncher.stop();
        }

        this.shutdown();
        await this.terminateSession(this._reason === TerminatingReason.DisconnectedFromWebsocket ? 'Got disconnect request' : 'Disconnected from websocket');

        return new DisconnectedCDA();
    }

    public shutdown(): void {
        // this._batchTelemetryReporter.finalize();
        this._session.shutdown();
    }

    public async terminateSession(reason: string, restart?: IRestartRequestArgs): Promise<void> {
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
        if ((<ILaunchRequestArgs>this._configuration.args).noDebug) {
            this._session.sendEvent(new TerminatedEvent(restart));
        }

        if (this._chromeConnection.isAttached) {
            this._chromeConnection.close();
        }
    }
}