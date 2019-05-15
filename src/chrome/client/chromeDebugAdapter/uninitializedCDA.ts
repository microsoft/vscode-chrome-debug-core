/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
import { DebugProtocol } from 'vscode-debugprotocol';
import { UnconnectedCDAProvider } from './unconnectedCDA';
import { IChromeDebugSessionOpts } from '../../chromeDebugSession';
import { IDebugAdapterState, IInitializeRequestArgs, ITelemetryPropertyCollector } from '../../../debugAdapterInterfaces';
import { BaseCDAState } from './baseCDAState';
import { TYPES } from '../../dependencyInjection.ts/types';
import { inject, injectable } from 'inversify';
import { isNotEmpty } from '../../utils/typedOperators';
let localize = nls.loadMessageBundle(); // Initialize to an unlocalized version until we know which locale to use

@injectable()
export class UninitializedCDA extends BaseCDAState {
    constructor(
        @inject(TYPES.UnconnectedCDAProvider) private readonly _unconnectedCDAProvider: UnconnectedCDAProvider,
        @inject(TYPES.IChromeDebugSessionOpts) private readonly _debugSessionOptions: IChromeDebugSessionOpts
    ) {
        super([], { 'initialize': (args, telemetryPropertyCollector) => this.initialize(<IInitializeRequestArgs>args, telemetryPropertyCollector) });
    }

    public async initialize(args: IInitializeRequestArgs, _telemetryPropertyCollector?: ITelemetryPropertyCollector): Promise<{ capabilities: DebugProtocol.Capabilities, newState: IDebugAdapterState }> {
        if (isNotEmpty(args.locale)) {
                localize = nls.config({ locale: args.locale })(); // Replace with the proper locale
        }

        const exceptionBreakpointFilters = [
            {
                label: localize('exceptions.all', 'All Exceptions'),
                filter: 'all',
                default: false
            },
            {
                label: localize('exceptions.uncaught', 'Uncaught Exceptions'),
                filter: 'uncaught',
                default: false
            }
        ];

        if (this._debugSessionOptions.extensibilityPoints.isPromiseRejectExceptionFilterEnabled) {
            exceptionBreakpointFilters.push({
                label: localize('exceptions.promise_rejects', 'Promise Rejects'),
                filter: 'promise_reject',
                default: false
            });
        }

        // This debug adapter supports two exception breakpoint filters
        const capabilities = {
            exceptionBreakpointFilters,
            supportsConfigurationDoneRequest: true,
            supportsSetVariable: true,
            supportsConditionalBreakpoints: true,
            supportsCompletionsRequest: true,
            supportsHitConditionalBreakpoints: true,
            supportsRestartFrame: true,
            supportsExceptionInfoRequest: true,
            supportsDelayedStackTraceLoading: true,
            supportsValueFormattingOptions: true,
            supportsEvaluateForHovers: true,
            supportsLoadedSourcesRequest: true
        };

        const newState = this._unconnectedCDAProvider(args);
        return { capabilities, newState };
    }
}