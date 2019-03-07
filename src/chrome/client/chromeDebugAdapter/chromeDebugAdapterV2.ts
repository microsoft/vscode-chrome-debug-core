/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { DebugProtocol } from 'vscode-debugprotocol';
import { ChromeDebugSession, IChromeDebugSessionOpts } from '../../chromeDebugSession';
import { ChromeConnection } from '../../chromeConnection';
import { StepProgressEventsEmitter, IObservableEvents, IStepStartedEventsEmitter, IFinishedStartingUpEventsEmitter } from '../../../executionTimingsReporter';
import { UninitializedCDA } from './uninitializedCDA';
import { IDebugAdapter, IDebugAdapterState, ITelemetryPropertyCollector } from '../../../debugAdapterInterfaces';
import { CommandText } from '../requests';

export class ChromeDebugAdapter implements IDebugAdapter, IObservableEvents<IStepStartedEventsEmitter & IFinishedStartingUpEventsEmitter>{
    public readonly events = new StepProgressEventsEmitter();
    private _state: IDebugAdapterState;

    constructor(args: IChromeDebugSessionOpts, originalSession: ChromeDebugSession) {
        this._state = new UninitializedCDA(args.extensibilityPoints, originalSession, args.extensibilityPoints.chromeConnection || ChromeConnection);
    }

    public async processRequest(requestName: CommandText, args: unknown, telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<unknown> {
        const response = await this._state.processRequest(requestName, args, telemetryPropertyCollector);
        switch (requestName) {
            case 'initialize':
                const { capabilities, newState } = <{ capabilities: DebugProtocol.Capabilities, newState: IDebugAdapterState }>response;
                this._state = newState;
                return capabilities;
            case 'launch':
            case 'attach':
                this._state = <IDebugAdapterState>response;
                return {};
            default:
                // For all other messages where the state doesn't change, we don't need to do anything
                return response;
        }
    }
}