/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { DebugProtocol } from 'vscode-debugprotocol';
import { ChromeDebugSession, IChromeDebugSessionOpts } from '../../chromeDebugSession';
import { StepProgressEventsEmitter, IObservableEvents, IStepStartedEventsEmitter, IFinishedStartingUpEventsEmitter } from '../../../executionTimingsReporter';
import { UninitializedCDA } from './uninitializedCDA';
import { IDebugAdapter, IDebugAdapterState, ITelemetryPropertyCollector } from '../../../debugAdapterInterfaces';
import { CommandText } from '../requests';
import { createDIContainer } from './cdaDIContainerCreator';
import { TYPES } from '../../dependencyInjection.ts/types';

export class ChromeDebugAdapter implements IDebugAdapter, IObservableEvents<IStepStartedEventsEmitter & IFinishedStartingUpEventsEmitter>{
    public readonly events = new StepProgressEventsEmitter();
    private readonly _diContainer = createDIContainer(this._rawDebugSession, this._debugSessionOptions).bindAll();

    // TODO: Find a better way to initialize the component instead of using waitUntilInitialized
    private waitUntilInitialized = Promise.resolve(<UninitializedCDA>null);

    private _state: IDebugAdapterState;

    constructor(private readonly _debugSessionOptions: IChromeDebugSessionOpts, private readonly _rawDebugSession: ChromeDebugSession) {
        const uninitializedCDA = this._diContainer.createComponent<UninitializedCDA>(TYPES.UninitializedCDA);
        this.waitUntilInitialized = uninitializedCDA.install();
        this._state = uninitializedCDA;
    }

    public async processRequest(requestName: CommandText, args: unknown, telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<unknown> {
        await this.waitUntilInitialized;

        const response = await this._debugSessionOptions.extensibilityPoints.processRequest(requestName, args, customizedArgs =>
            this._state.processRequest(requestName, customizedArgs, telemetryPropertyCollector));
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