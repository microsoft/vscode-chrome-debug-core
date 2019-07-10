/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { CDTPEventsEmitterDiagnosticsModule } from '../infrastructure/cdtpDiagnosticsModule';
import { asyncMap } from '../../collections/async';
import { CDTPStackTraceParser } from '../protocolParsers/cdtpStackTraceParser';
import { CDTPBreakpointIdsRegistry } from '../registries/cdtpBreakpointIdsRegistry';
import { ScriptCallFrame, CodeFlowFrame, CallFrameWithState } from '../../internal/stackTraces/callFrame';
import { asyncUndefinedOnFailure } from '../../utils/failures';
import { CDTPLocationParser } from '../protocolParsers/cdtpLocationParser';
import { Scope } from '../../internal/stackTraces/scopes';
import { IScript } from '../../internal/scripts/script';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { Protocol as CDTP } from 'devtools-protocol';
import { CodeFlowStackTrace } from '../../internal/stackTraces/codeFlowStackTrace';
import { CDTPScriptsRegistry } from '../registries/cdtpScriptsRegistry';
import { CDTPCallFrameRegistry } from '../registries/cdtpCallFrameRegistry';
import { CDTPDomainsEnabler } from '../infrastructure/cdtpDomainsEnabler';
import { CDTPBPRecipe, validateNonPrimitiveRemoteObject } from '../cdtpPrimitives';
import * as _ from 'lodash';
import { isDefined } from '../../utils/typedOperators';

export type PauseEventReason = 'XHR' | 'DOM' | 'EventListener' | 'exception' | 'assert' | 'debugCommand' | 'promiseRejection' | 'OOM' | 'other' | 'ambiguous';

export class PausedEvent {
    constructor(
        public readonly callFrames: ScriptCallFrame<CallFrameWithState>[],
        public readonly reason: PauseEventReason,
        public readonly data: any,
        public readonly hitBreakpoints: CDTPBPRecipe[],
        public readonly asyncStackTrace: CodeFlowStackTrace | undefined,
        public readonly asyncStackTraceId: CDTP.Runtime.StackTraceId | undefined,
        public readonly asyncCallStackTraceId: CDTP.Runtime.StackTraceId | undefined) { }

    public toString(): string {
        return `Debugger paused due to ${this.reason} on ${this.callFrames.length > 0 ? this.callFrames[0] : 'No call frame'}${this.hitBreakpoints.length > 0 ? 'at ' + this.hitBreakpoints.join(',') : ''}`;
    }
}

export interface ICDTPDebuggeeExecutionEventsProvider {
    onPaused(listener: (event: PausedEvent) => void): void;
    onResumed(listener: () => void): void;
}

@injectable()
export class CDTPDebuggeeExecutionEventsProvider extends CDTPEventsEmitterDiagnosticsModule<CDTP.DebuggerApi, void, CDTP.Debugger.EnableResponse> implements ICDTPDebuggeeExecutionEventsProvider {
    protected readonly api = this._protocolApi.Debugger;

    private readonly _cdtpLocationParser = new CDTPLocationParser(this._scriptsRegistry);
    private readonly _stackTraceParser = new CDTPStackTraceParser(this._scriptsRegistry);

    public readonly onPaused = this.addApiListener('paused', async (params: CDTP.Debugger.PausedEvent) => {
        if (params.callFrames.length === 0) {
            throw new Error(`Expected a pause event to have at least a single call frame: ${JSON.stringify(params)}`);
        }

        const callFrames = await asyncMap(params.callFrames, (callFrame, index) => this.toCallFrame(index, callFrame));

        return new PausedEvent(callFrames, params.reason, params.data, await asyncMap(_.defaultTo(params.hitBreakpoints, []), hbp => this.getBPFromID(hbp)),
            isDefined(params.asyncStackTrace) ? await this._stackTraceParser.toStackTraceCodeFlow(params.asyncStackTrace) : undefined,
            params.asyncStackTraceId, params.asyncCallStackTraceId);
    });

    public readonly onResumed = this.addApiListener('resumed', (params: void) => params);

    constructor(
        @inject(TYPES.CDTPClient) private readonly _protocolApi: CDTP.ProtocolApi,
        @inject(TYPES.CDTPScriptsRegistry) private _scriptsRegistry: CDTPScriptsRegistry,
        private readonly _breakpointIdRegistry: CDTPBreakpointIdsRegistry,
        private readonly _callFrameRegistry: CDTPCallFrameRegistry,
        @inject(TYPES.IDomainsEnabler) domainsEnabler: CDTPDomainsEnabler,
    ) {
        super(domainsEnabler);
    }

    private getBPFromID(hitBreakpoint: CDTP.Debugger.BreakpointId): CDTPBPRecipe {
        return this._breakpointIdRegistry.getRecipeByBreakpointId(hitBreakpoint);
    }

    private async toCallFrame(index: number, callFrame: CDTP.Debugger.CallFrame): Promise<ScriptCallFrame<CallFrameWithState>> {
        const frame = new ScriptCallFrame(await this.toCodeFlowFrame(index, callFrame),
            new CallFrameWithState(await asyncMap(callFrame.scopeChain, scope => this.toScope(scope)),
                callFrame.this, callFrame.returnValue));

        this._callFrameRegistry.registerFrameId(callFrame.callFrameId, frame);

        return frame;
    }

    private toCodeFlowFrame(index: number, callFrame: CDTP.Debugger.CallFrame): Promise<CodeFlowFrame<IScript>> {
        return this._stackTraceParser.toCodeFlowFrame(index, callFrame, callFrame.location);
    }

    private async toScope(scope: CDTP.Debugger.Scope): Promise<Scope> {
        if (validateNonPrimitiveRemoteObject(scope.object)) {
            return new Scope(
                scope.type,
                scope.object,
                scope.name,
                // TODO FILE BUG: Chrome sometimes returns line -1 when the doc says it's 0 based
                await asyncUndefinedOnFailure(async () => isDefined(scope.startLocation) ? await this._cdtpLocationParser.getLocationInScript(scope.startLocation) : undefined),
                await asyncUndefinedOnFailure(async () => isDefined(scope.endLocation) ? await this._cdtpLocationParser.getLocationInScript(scope.endLocation) : undefined));
        } else {
            throw new Error(`Expected the remote object of a scope to be of type object yet it wasn't: ${JSON.stringify(scope.object)}`);
        }
    }
}
