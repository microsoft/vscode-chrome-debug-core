import { EventsConsumedByStackTrace } from '../../internal/stackTraces/stackTracesLogic';
import { EventsConsumedBySkipFilesLogic } from '../../internal/features/skipFiles';
import { EventsConsumedByBreakpointsLogic } from '../../internal/breakpoints/breakpointsLogic';
import { ICommunicator } from '../../communication/communicator';
import { Internal } from '../../communication/internalChannels';
import { Target } from '../../communication/targetChannels';
import { ILoadedSource } from '../../internal/sources/loadedSource';
import { asyncMap } from '../../collections/async';
import { EventsConsumedByPauseOnException } from '../../internal/exceptions/pauseOnException';
import { EventsConsumedByTakeProperActionOnPausedEvent } from '../../internal/features/takeProperActionOnPausedEvent';
import { EventsConsumedBySourceResolverLogic } from '../../internal/sources/sourceResolverLogic';
import { EventsConsumedBySmartStepLogic } from '../../internal/features/smartStep';
import { ReAddBPsWhenSourceIsLoadedDependencies } from '../../internal/breakpoints/features/reAddBPsWhenSourceIsLoaded';

export interface EventsConsumedByConnectedCDA extends EventsConsumedByBreakpointsLogic, EventsConsumedByPauseOnException,
    EventsConsumedByStackTrace, EventsConsumedByTakeProperActionOnPausedEvent, EventsConsumedBySkipFilesLogic,
    EventsConsumedBySourceResolverLogic, EventsConsumedBySmartStepLogic,
    ReAddBPsWhenSourceIsLoadedDependencies { }

export class ConnectedCDAEventsCreator {
    constructor(private readonly communicator: ICommunicator) { }

    public create(): EventsConsumedByConnectedCDA {
        const onLoadedSourceIsAvailable = (listener: (source: ILoadedSource) => void) => {
            this.communicator.subscribe(Target.Debugger.OnScriptParsed, async scriptParsed => {
                await asyncMap(scriptParsed.script.allSources, listener);
            });
        };

        return {
            onLoadedSourceIsAvailable: onLoadedSourceIsAvailable,

            notifyNoPendingBPs: this.communicator.getPublisher(Internal.Breakpoints.OnNoPendingBreakpoints),

            onResumed: this.communicator.getSubscriber(Target.Debugger.OnResumed),
            onPaused: this.communicator.getSubscriber(Target.Debugger.OnPaused),
            onAsyncBreakpointResolved: this.communicator.getSubscriber(Target.Debugger.OnAsyncBreakpointResolved),

            onScriptParsed: this.communicator.getSubscriber(Target.Debugger.OnScriptParsed),

            subscriberForAskForInformationAboutPaused: this.communicator.getSubscriber(Internal.Breakpoints.OnPausedOnBreakpoint),
            askForInformationAboutPause: this.communicator.getPublisher(Internal.Breakpoints.OnPausedOnBreakpoint),
        };
    }
}
