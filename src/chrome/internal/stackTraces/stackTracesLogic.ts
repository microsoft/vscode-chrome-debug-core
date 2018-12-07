import { DebugProtocol } from 'vscode-debugprotocol';
import { injectable, inject, LazyServiceIdentifer } from 'inversify';

import * as errors from '../../../errors';
import * as path from 'path';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();
import { PausedEvent } from '../../target/events';
import { StackTracePresentation, FramePresentationOrLabel, StackTraceLabel } from './stackTracePresentation';
import { ILoadedSource } from '../sources/loadedSource';
import { CodeFlowStackTrace } from './stackTrace';
import { IScript } from '../scripts/script';
import { CodeFlowFrame, ICallFrame, ScriptCallFrame, LoadedSourceCallFrame } from './callFrame';
import { LocationInLoadedSource } from '../locations/location';
import { CallFramePresentation, CallFramePresentationHint, SourcePresentationHint, ICallFramePresentationDetails } from './callFramePresentation';
import { FormattedName } from './callFrameName';
import { IComponent, ComponentConfiguration } from '../features/feature';
import { InformationAboutPausedProvider } from '../features/takeProperActionOnPausedEvent';
import { asyncMap } from '../../collections/async';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IAsyncDebuggingConfiguration } from '../../target/cdtpDebugger';

export interface EventsConsumedByStackTrace {
    subscriberForAskForInformationAboutPaused(listener: InformationAboutPausedProvider): void;
    onResumed(listener: () => void): void;
}

export interface IStackTracePresentationLogicProvider {
    getCallFrameAdditionalDetails(locationInLoadedSource: LocationInLoadedSource): ICallFramePresentationDetails[];
}

export interface IStackTracesConfiguration {
    showAsyncStacks: boolean;
}

@injectable()
export class StackTracesLogic implements IComponent {
    public static ASYNC_CALL_STACK_DEPTH = 4;

    private _currentPauseEvent: PausedEvent | null = null;

    public onResumed(): any {
        this._currentPauseEvent = null;
    }

    public onPaused(pausedEvent: PausedEvent): any {
        this._currentPauseEvent = pausedEvent;
    }

    public async stackTrace(args: DebugProtocol.StackTraceArguments): Promise<StackTracePresentation> {
        if (!this._currentPauseEvent) {
            return Promise.reject(errors.noCallStackAvailable());
        }

        const syncFames: FramePresentationOrLabel<ILoadedSource>[] = await asyncMap(this._currentPauseEvent.callFrames, frame => this.toPresentation(frame, args.format));
        const asyncStackTrace = this._currentPauseEvent.asyncStackTrace;
        let stackFrames = asyncStackTrace ? syncFames.concat(await this.asyncCallFrames(asyncStackTrace, args.format)) : syncFames;

        const totalFrames = stackFrames.length;
        if (typeof args.startFrame === 'number') {
            stackFrames = stackFrames.slice(args.startFrame);
        }

        if (typeof args.levels === 'number') {
            stackFrames = stackFrames.slice(0, args.levels);
        }

        const stackTraceResponse: StackTracePresentation = {
            stackFrames,
            totalFrames
        };

        return stackTraceResponse;
    }

    private async asyncCallFrames(stackTrace: CodeFlowStackTrace<IScript>, formatArgs?: DebugProtocol.StackFrameFormat): Promise<FramePresentationOrLabel<ILoadedSource>[]> {
        const asyncFrames: FramePresentationOrLabel<ILoadedSource>[] = await asyncMap(stackTrace.codeFlowFrames,
            frame => this.toPresentation(this.codeFlowToCallFrame(frame), formatArgs));

        asyncFrames.unshift(new StackTraceLabel(stackTrace.description));

        return asyncFrames.concat(stackTrace.parent ? await this.asyncCallFrames(stackTrace.parent, formatArgs) : []);
    }

    private codeFlowToCallFrame(frame: CodeFlowFrame<IScript>): ICallFrame<IScript> {
        return new ScriptCallFrame(frame, [], undefined, undefined);
    }

    private formatStackFrameName(name: string, locationInLoadedSource: LocationInLoadedSource, formatArgs?: DebugProtocol.StackFrameFormat): string {
        let formattedName = name;
        if (formatArgs) {
            if (formatArgs.module) {
                formattedName += ` [${path.basename(locationInLoadedSource.source.identifier.textRepresentation)}]`;
            }

            if (formatArgs.line) {
                formattedName += ` Line ${locationInLoadedSource.lineNumber}`;
            }
        }

        return formattedName;
    }

    private async toPresentation(frame: ICallFrame<IScript>, formatArgs?: DebugProtocol.StackFrameFormat): Promise<CallFramePresentation<ILoadedSource>> {
        // DIEGO TODO: Make getReadonlyOrigin work again
        // this.getReadonlyOrigin(frame.location.script.runtimeSource.identifier.textRepresentation)
        const locationInLoadedSource = frame.location.asLocationInLoadedSource();

        let presentationHint: CallFramePresentationHint = 'normal';

        // Apply hints to skipped frames
        const getSkipReason = (reason: string) => localize('skipReason', "(skipped by '{0}')", reason);
        const providedDetails: ICallFramePresentationDetails[] = [].concat(await asyncMap(this._stackTracePresentationLogicProviders, provider => provider.getCallFrameAdditionalDetails(locationInLoadedSource)));
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

        const formattedName = this.formatStackFrameName(frame.name, locationInLoadedSource, formatArgs);
        const codeFlow = new CodeFlowFrame<ILoadedSource>(frame.index, new FormattedName(formattedName), locationInLoadedSource);
        const callFrame = new LoadedSourceCallFrame(frame, codeFlow);

        return new CallFramePresentation<ILoadedSource>(callFrame, presentationDetails, presentationHint);
    }

    public async install(configuration: ComponentConfiguration): Promise<this> {
        this._dependencies.subscriberForAskForInformationAboutPaused(params => this.onPaused(params));
        this._dependencies.onResumed(() => this.onResumed());
        return await this.configure(configuration);
    }

    private async configure(configuration: ComponentConfiguration): Promise<this> {
        const showAsyncStacks = typeof configuration.args.showAsyncStacks === 'undefined' || configuration.args.showAsyncStacks;
        const maxDepth = showAsyncStacks ? StackTracesLogic.ASYNC_CALL_STACK_DEPTH : 0;

        try {
            await this._breakpointFeaturesSupport.setAsyncCallStackDepth(maxDepth);
        } catch (e) {
            // Not supported by older runtimes, ignore it.
        }
        return this;
    }

    constructor(
        @inject(TYPES.EventsConsumedByConnectedCDA) private readonly _dependencies: EventsConsumedByStackTrace,
        // TODO DIEGO: @multiInject(new LazyServiceIdentifer(() => TYPES.IStackTracePresentationLogicProvider)) private readonly _stackTracePresentationLogicProviders: IStackTracePresentationLogicProvider[],
        @inject(new LazyServiceIdentifer(() => TYPES.IStackTracePresentationLogicProvider)) private readonly _stackTracePresentationLogicProviders: IStackTracePresentationLogicProvider[],
        @inject(TYPES.IAsyncDebuggingConfiguration) private readonly _breakpointFeaturesSupport: IAsyncDebuggingConfiguration) {
    }
}