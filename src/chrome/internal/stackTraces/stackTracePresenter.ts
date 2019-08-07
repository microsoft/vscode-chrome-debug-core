
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { injectable, inject, multiInject } from 'inversify';

import * as errors from '../../../errors';

import * as nls from 'vscode-nls';
import { CodeFlowStackTrace } from './codeFlowStackTrace';
import { IScript } from '../scripts/script';
import { CodeFlowFrame, ScriptCallFrame, CallFrame, CallFrameWithoutState, ICallFrameState } from './callFrame';
import { LocationInLoadedSource } from '../locations/location';
import { CallFramePresentation, SourcePresentationHint, ICallFramePresentationDetails } from './callFramePresentation';
import { IInstallableComponent } from '../features/components';
import { asyncMap } from '../../collections/async';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IAsyncDebuggingConfigurer } from '../../cdtpDebuggee/features/cdtpAsyncDebuggingConfigurer';
import { IStackTracePresentation } from './stackTracePresentation';
import { StackTraceLabel, CallFramePresentationHint, IStackTracePresentationRow } from './stackTracePresentationRow';
import { ConnectedCDAConfiguration } from '../../client/chromeDebugAdapter/cdaConfiguration';
import { CurrentStackTraceProvider } from './currentStackTraceProvider';
import { ICDTPDebuggeeExecutionEventsProvider } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import * as _ from 'lodash';
import { isDefined, isNotEmpty } from '../../utils/typedOperators';
import { DoNotLog } from '../../logging/decorators';
import { registerGetLocalize } from '../../utils/localizedError';

let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

export interface IStackTracePresentationDetailsProvider {
    callFrameAdditionalDetails(locationInLoadedSource: LocationInLoadedSource): ICallFramePresentationDetails[];
}

export interface IStackTraceFormat {}

export class StackTraceCustomFormat implements IStackTraceFormat {
    public constructor(public readonly formatOptions: DebugProtocol.StackFrameFormat) { }

    public toString(): string {
        return JSON.stringify(this.formatOptions);
    }
}

export class StackTraceDefaultFormat implements IStackTraceFormat {
    public toString(): string {
        return `default format`;
    }
}

/**
 * Prepares the current stack trace to be presented to the client/user
 */
@injectable()
export class StackTracePresenter implements IInstallableComponent {
    public static DEFAULT_ASYNC_CALL_STACK_MAX_DEPTH = 4;

    private readonly _currentStackStraceProvider = new CurrentStackTraceProvider(this._cdtpDebuggeeExecutionEventsProvider);

    public constructor(
        @inject(TYPES.ICDTPDebuggeeExecutionEventsProvider) private readonly _cdtpDebuggeeExecutionEventsProvider: ICDTPDebuggeeExecutionEventsProvider,
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
        @multiInject(TYPES.IStackTracePresentationLogicProvider) private readonly _stackTracePresentationLogicProviders: IStackTracePresentationDetailsProvider[],
        @inject(TYPES.IAsyncDebuggingConfiguration) private readonly _breakpointFeaturesSupport: IAsyncDebuggingConfigurer) { }

    @DoNotLog()
    public async stackTrace(format: IStackTraceFormat, firstFrameIndex: number, framesCountOrNull: number | null): Promise<IStackTracePresentation> {
        if (!this._currentStackStraceProvider.isPaused()) {
            return Promise.reject(errors.noCallStackAvailable());
        }

        const syncFrames: IStackTracePresentationRow[] = await this.syncCallFrames(format);
        const asyncStackTraceOrUndefined = this._currentStackStraceProvider.asyncStackTrace();
        const asyncFrames = isDefined(asyncStackTraceOrUndefined)
            ? await this.asyncCallFrames(asyncStackTraceOrUndefined, format)
            : [];
        const allStackFrames = syncFrames.concat(asyncFrames);

        let stackFrames = this.framesRange(allStackFrames, firstFrameIndex, framesCountOrNull);

        const stackTraceResponse: IStackTracePresentation = {
            stackFrames,
            totalFrames: allStackFrames.length
        };

        return stackTraceResponse;
    }

    private async syncCallFrames(format: IStackTraceFormat): Promise<IStackTracePresentationRow[]> {
        return await asyncMap(this._currentStackStraceProvider.syncStackFrames(), frame => this.toPresentation(frame, format));
    }

    private async asyncCallFrames(stackTrace: CodeFlowStackTrace, formatArgs?: IStackTraceFormat): Promise<IStackTracePresentationRow[]> {
        const thisSectionAsyncFrames = await asyncMap(stackTrace.codeFlowFrames,
            frame => this.toPresentation(this.codeFlowToCallFrame(frame), formatArgs));
        const parentAsyncFrames = isDefined(stackTrace.parent) ? await this.asyncCallFrames(stackTrace.parent, formatArgs) : [];

        return (isNotEmpty(stackTrace.description)
            ? [/* Description of this section of async frames */<IStackTracePresentationRow>new StackTraceLabel(stackTrace.description)]
            : [])
            .concat(thisSectionAsyncFrames, parentAsyncFrames);
    }

    private framesRange(allStackFrames: IStackTracePresentationRow[], firstFrameIndex: number, framesCountOrNull: number | null) {
        const framesCount = framesCountOrNull !== null ? firstFrameIndex + framesCountOrNull : allStackFrames.length - firstFrameIndex;
        return allStackFrames.slice(firstFrameIndex, framesCount);
    }

    private codeFlowToCallFrame(frame: CodeFlowFrame<IScript>): ScriptCallFrame<CallFrameWithoutState> {
        return new ScriptCallFrame(frame, new CallFrameWithoutState());
    }

    private async toPresentation(frame: CallFrame<IScript, ICallFrameState>, formatArgs?: IStackTraceFormat): Promise<CallFramePresentation> {
        // TODO: Make getReadonlyOrigin work again
        // this.getReadonlyOrigin(frame.location.script.runtimeSource.identifier.textRepresentation)
        let presentationHint: CallFramePresentationHint = 'normal';

        // Apply hints to skipped frames
        const getSkipReason = (reason: string) => localize('skipReason', "(skipped by '{0}')", reason);
        const locationInLoadedSource = frame.location.mappedToSource();
        const providedDetails: ICallFramePresentationDetails[] = _.flatten(await asyncMap(this._stackTracePresentationLogicProviders, provider =>
            provider.callFrameAdditionalDetails(locationInLoadedSource)));
        const actualDetails = providedDetails.length === 0
            ? [{
                additionalSourceOrigins: [] as string[],
                sourcePresentationHint: 'normal' as SourcePresentationHint
            }]
            : providedDetails; // Here we guarantee that actualDetails.length > 0
        const allAdditionalSourceOrigins = await asyncMap(actualDetails, detail => detail.additionalSourceOrigins);

        const presentationDetails: ICallFramePresentationDetails = {
            additionalSourceOrigins: allAdditionalSourceOrigins.length > 0 ? [getSkipReason(allAdditionalSourceOrigins.join(','))] : [],
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