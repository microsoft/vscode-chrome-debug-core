import { UnconnectedCDACommonLogic } from './unconnectedCDACommonLogic';
import { ChromeConnection } from '../../chromeConnection';
import { IDebugAdapterState, ChromeDebugLogic, ITelemetryPropertyCollector, IInitializeRequestArgs, ChromeDebugSession } from '../../..';
import { DebugProtocol } from 'vscode-debugprotocol';
import { UnconnectedCDA } from './unconnectedCDA';
import { IExtensibilityPoints } from '../../extensibility/extensibilityPoints';
import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle(); // Initialize to an unlocalized version until we know which locale to use

export class UninitializedCDA extends UnconnectedCDACommonLogic implements IDebugAdapterState {
    public chromeDebugAdapter(): ChromeDebugLogic {
        throw new Error('Method not implemented.');
    }

    public async initialize(args: IInitializeRequestArgs, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<{ capabilities: DebugProtocol.Capabilities, newState: IDebugAdapterState }> {
        if (args.locale) {
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

        if (this._extensibilityPoints.isPromiseRejectExceptionFilterEnabled) {
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

        const newState = new UnconnectedCDA(this._extensibilityPoints, this._session, args, this._chromeConnectionClass);
        return { capabilities, newState };
    }

    constructor(
        private readonly _extensibilityPoints: IExtensibilityPoints,
        private readonly _session: ChromeDebugSession,
        private readonly _chromeConnectionClass: typeof ChromeConnection
    ) {
        super();
    }
}