/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { injectable, inject, multiInject } from 'inversify';

import * as errors from '../../../errors';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();
import { CodeFlowStackTrace } from './codeFlowStackTrace';
import { IScript } from '../scripts/script';
import { CodeFlowFrame, ScriptCallFrame, CallFrame } from './callFrame';
import { LocationInLoadedSource } from '../locations/location';
import { CallFramePresentation, SourcePresentationHint, ICallFramePresentationDetails } from './callFramePresentation';
import { IComponentWithAsyncInitialization } from '../features/components';
import { asyncMap } from '../../collections/async';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IAsyncDebuggingConfigurer } from '../../cdtpDebuggee/features/cdtpAsyncDebuggingConfigurer';
import { IStackTracePresentation } from './stackTracePresentation';
import { StackTraceLabel, CallFramePresentationHint, IStackTracePresentationRow } from './stackTracePresentationRow';
import { ConnectedCDAConfiguration } from '../../client/chromeDebugAdapter/cdaConfiguration';
import { CurrentStackTraceProvider } from './currentStackTraceProvider';
import { ICDTPDebuggeeExecutionEventsProvider } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';

export interface IStackTracePresentationDetailsProvider {
    callFrameAdditionalDetails(locationInLoadedSource: LocationInLoadedSource): ICallFramePresentationDetails[];
}

/**
 * Prepares the current stack trace to be presented to the client/user
 */
@injectable()
export class StackTracePresenter implements IComponentWithAsyncInitialization {
    public static DEFAULT_ASYNC_CALL_STACK_MAX_DEPTH = 4;

    private readonly _currentStackStraceProvider = new CurrentStackTraceProvider(this._cdtpDebuggeeExecutionEventsProvider);

    public constructor(
        @inject(TYPES.ICDTPDebuggeeExecutionEventsProvider) private readonly _cdtpDebuggeeExecutionEventsProvider: ICDTPDebuggeeExecutionEventsProvider,
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
        @multiInject(TYPES.IStackTracePresentationLogicProvider) private readonly _stackTracePresentationLogicProviders: IStackTracePresentationDetailsProvider[],
        @inject(TYPES.IAsyncDebuggingConfiguration) private readonly _breakpointFeaturesSupport: IAsyncDebuggingConfigurer) {}

    public async stackTrace(formatOrNull: DebugProtocol.StackFrameFormat | null, firstFrameIndex: number, framesCountOrNull?: number): Promise<IStackTracePresentation> {
        if (!this._currentStackStraceProvider.isPaused()) {
            return Promise.reject(errors.noCallStackAvailable());
        }

        const syncFrames: IStackTracePresentationRow[] = await this.syncCallFrames(formatOrNull);
        const asyncFrames = !!this._currentStackStraceProvider.asyncStackTrace()
            ? await this.asyncCallFrames(this._currentStackStraceProvider.asyncStackTrace(), formatOrNull)
            : [];
        const allStackFrames = syncFrames.concat(asyncFrames);

        let stackFrames = this.framesRange(allStackFrames, firstFrameIndex, framesCountOrNull);

        const stackTraceResponse: IStackTracePresentation = {
            stackFrames,
            totalFrames: allStackFrames.length
        };

        return stackTraceResponse;
    }

    private async syncCallFrames(format: DebugProtocol.StackFrameFormat): Promise<IStackTracePresentationRow[]> {
        return await asyncMap(this._currentStackStraceProvider.syncStackFrames(), frame => this.toPresentation(frame, format));
    }

    private async asyncCallFrames(stackTrace: CodeFlowStackTrace, formatArgs?: DebugProtocol.StackFrameFormat): Promise<IStackTracePresentationRow[]> {
        const thisSectionAsyncFrames = await asyncMap(stackTrace.codeFlowFrames,
            frame => this.toPresentation(this.codeFlowToCallFrame(frame), formatArgs));
        const parentAsyncFrames = stackTrace.parent ? await this.asyncCallFrames(stackTrace.parent, formatArgs) : [];

        return [/* Description of this section of async frames */<IStackTracePresentationRow>new StackTraceLabel(stackTrace.description)].concat(thisSectionAsyncFrames, parentAsyncFrames);
    }

    private framesRange(allStackFrames: IStackTracePresentationRow[], firstFrameIndex: number, framesCount?: number) {
        return allStackFrames.slice(firstFrameIndex, firstFrameIndex + framesCount);
    }

    private codeFlowToCallFrame(frame: CodeFlowFrame<IScript>): ScriptCallFrame {
        return new ScriptCallFrame(frame, [], undefined, undefined);
    }

    private async toPresentation(frame: CallFrame<IScript>, formatArgs?: DebugProtocol.StackFrameFormat): Promise<CallFramePresentation> {
        // TODO: Make getReadonlyOrigin work again
        // this.getReadonlyOrigin(frame.location.script.runtimeSource.identifier.textRepresentation)
        let presentationHint: CallFramePresentationHint = 'normal';

        // Apply hints to skipped frames
        const getSkipReason = (reason: string) => localize('skipReason', "(skipped by '{0}')", reason);
        const locationInLoadedSource = frame.location.mappedToSource();
        const providedDetails: ICallFramePresentationDetails[] = [].concat(await asyncMap(this._stackTracePresentationLogicProviders, provider =>
            provider.callFrameAdditionalDetails(locationInLoadedSource)));
        const actualDetails = providedDetails.length === 0
            ? [{
                additionalSourceOrigins: [] as string[],
                sourcePresentationHint: 'normal' as SourcePresentationHint
            }]
            : providedDetails; // Here we guarantee that actualDetails.length > 0
        const allAdditionalSourceOrigins = await asyncMap(actualDetails, detail => detail.additionalSourceOrigins);

        const presentationDetails: ICallFramePresentationDetails = {
            additionalSourceOrigins: [getSkipReason(allAdditionalSourceOrigins.join(','))],
            sourcePresentationHint: actualDetails[0].sourcePresentationHint // We know that actualDetails.length > 0
        };

        return new CallFramePresentation(frame.mappedToSource(),
            formatArgs, presentationDetails, presentationHint);
    }

    public async install(): Promise<this> {
        return await this.configure(this._configuration);
    }

    private async configure(configuration: ConnectedCDAConfiguration): Promise<this> {
        const showAsyncStacks = typeof configuration.args.showAsyncStacks === 'undefined' || configuration.args.showAsyncStacks;
        const maxDepth = showAsyncStacks ? StackTracePresenter.DEFAULT_ASYNC_CALL_STACK_MAX_DEPTH : 0;

        try {
            await this._breakpointFeaturesSupport.setAsyncCallStackDepth(maxDepth);
        } catch (e) {
            // Not supported by older runtimes, ignore it.
        }
        return this;
    }
}