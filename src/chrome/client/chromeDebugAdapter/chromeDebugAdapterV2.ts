/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { DebugProtocol } from 'vscode-debugprotocol';
import { ChromeDebugSession, IChromeDebugSessionOpts } from '../../chromeDebugSession';
import { StepProgressEventsEmitter, IObservableEvents, IStepStartedEventsEmitter, IFinishedStartingUpEventsEmitter, ExecutionTimingsReporter } from '../../../executionTimingsReporter';
import { UninitializedCDA } from './uninitializedCDA';
import { IDebugAdapter, IDebugAdapterState, ITelemetryPropertyCollector } from '../../../debugAdapterInterfaces';
import { CommandText } from '../requests';
import { createDIContainer } from './cdaDIContainerCreator';
import { TerminatingCDA } from './terminatingCDA';
import { logger } from 'vscode-debugadapter';
import { isUndefined } from '../../utils/typedOperators';
import { TYPES } from '../../dependencyInjection.ts/types';

export class ChromeDebugAdapter implements IDebugAdapter, IObservableEvents<IStepStartedEventsEmitter & IFinishedStartingUpEventsEmitter>{
    public readonly events = new StepProgressEventsEmitter();
    private readonly _diContainer = createDIContainer(this, this._rawDebugSession, this._debugSessionOptions).bindAll();

    // TODO: Find a better way to initialize the component instead of using waitUntilInitialized
    private waitUntilInitialized = Promise.resolve(<UninitializedCDA><unknown>null);

    private _state: IDebugAdapterState;

    constructor(private readonly _debugSessionOptions: IChromeDebugSessionOpts, private readonly _rawDebugSession: ChromeDebugSession,
        reporter: ExecutionTimingsReporter) {
        const uninitializedCDA = this._diContainer.createComponent<UninitializedCDA>(TYPES.UninitializedCDA);
        this.waitUntilInitialized = uninitializedCDA.install();
        this._state = uninitializedCDA;
        reporter.subscribeTo(this.events);
    }

    public async processRequest(requestName: CommandText, args: unknown, telemetryPropertyCollector: ITelemetryPropertyCollector): Promise<unknown> {
        await this.waitUntilInitialized;

        const response = await this._debugSessionOptions.extensibilityPoints.processRequest(requestName, args, customizedArgs => {
            this.validateProcessRequestIsDefined();
            return this._state.processRequest(requestName, customizedArgs, telemetryPropertyCollector);
        });
        switch (requestName) {
            case 'initialize':
                const { capabilities, newState } = <{ capabilities: DebugProtocol.Capabilities, newState: IDebugAdapterState }>response;
                this.changeStateTo(newState);
                return capabilities;
            case 'launch':
            case 'attach':
                this.changeStateTo(<IDebugAdapterState>response);
                return {};
            default:
                // For all other messages where the state doesn't change, we don't need to do anything
                return response;
        }
    }

    public async terminate(terminatingCDA: TerminatingCDA): Promise<void> {
        this.changeStateTo(terminatingCDA);
        this.changeStateTo(await terminatingCDA.terminate()); // This should change the state to TerminatedCDA
    }

    private changeStateTo(newState: IDebugAdapterState) {
        logger.log(`Changing ChromeDebugAdapter state to ${newState}`);
        this._state = newState;
        this.validateProcessRequestIsDefined();
    }

    private validateProcessRequestIsDefined() {
        if (isUndefined(this._state.processRequest)) {
            throw new Error(localize('error.da.cantChangeToStateLackingProcessRequest', 'Invalid state: {0}', `${this._state}`));
        }
    }
}