import { asyncMap } from '../../../collections/async';
import { PausedEvent } from '../../../target/events';
import { ILoadedSource } from '../../sources/loadedSource';
import { IComponent } from '../../features/feature';
import { LocationInScript, ScriptOrSourceOrIdentifierOrUrlRegexp } from '../../locations/location';
import { IBreakpoint } from '../breakpoint';
import { NotifyStoppedCommonLogic, ResumeCommonLogic, InformationAboutPausedProvider } from '../../features/takeProperActionOnPausedEvent';
import { ReasonType } from '../../../stoppedEvent';
import { TargetVersions } from '../../../chromeTargetDiscoveryStrategy';
import { VoteRelevance, Vote, Abstained } from '../../../communication/collaborativeDecision';
import { injectable, inject } from 'inversify';
import { IDOMInstrumentationBreakpoints } from '../../../target/cdtpSmallerModules';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { IEventsToClientReporter } from '../../../client/eventSender';
import { IDebugeeExecutionControl } from '../../../target/controlDebugeeExecution';

export type Dummy = VoteRelevance; // If we don't do this the .d.ts doesn't include VoteRelevance and the compilation fails. Remove this when the issue disappears...

export interface PauseScriptLoadsToSetBPsDependencies {
    subscriberForAskForInformationAboutPaused(listener: InformationAboutPausedProvider): void;
    waitUntilUnbindedBPsAreSet(loadedSource: ILoadedSource): Promise<void>;

    tryGettingBreakpointAtLocation(locationInScript: LocationInScript): IBreakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>[];
}

export interface PauseScriptLoadsToSetBPsConfiguration {
    debugeeVersion: Promise<TargetVersions>;
}

export class HitStillPendingBreakpoint extends NotifyStoppedCommonLogic {
    public readonly relevance = VoteRelevance.NormalVote;
    protected reason: ReasonType = 'breakpoint';

    constructor(protected readonly _eventsToClientReporter: IEventsToClientReporter) {
        super();
    }
}

export class PausedWhileLoadingScriptToResolveBreakpoints extends ResumeCommonLogic {
    public readonly relevance = VoteRelevance.FallbackVote;

    constructor(protected readonly _debugeeExecutionControl: IDebugeeExecutionControl) {
        super();
    }
}

@injectable()
export class PauseScriptLoadsToSetBPs implements IComponent<PauseScriptLoadsToSetBPsConfiguration> {
    private readonly stopsWhileScriptsLoadInstrumentationName = 'scriptFirstStatement';
    private _isInstrumentationEnabled = false;
    private _scriptFirstStatementStopsBeforeFile: boolean;

    public async enableIfNeccesary(): Promise<void> {
        if (this._isInstrumentationEnabled === false) {
            await this.startPausingOnScriptFirstStatement();
        }
    }

    public async disableIfNeccesary(): Promise<void> {
        if (this._isInstrumentationEnabled === true) {
            await this.stopPausingOnScriptFirstStatement();
        }
    }

    private async askForInformationAboutPaused(paused: PausedEvent): Promise<Vote<void>> {
        if (this.isInstrumentationPause(paused)) {
            await asyncMap(paused.callFrames[0].location.script.allSources, async source => {
                await this._dependencies.waitUntilUnbindedBPsAreSet(source);
            });

            // If we pause before starting the script, we can just resume, and we'll a breakpoint if it's on 0,0
            if (!this._scriptFirstStatementStopsBeforeFile) {
                // On Chrome 69 we pause inside the script, so we need to check if there is a breakpoint at 0,0 that we need to use
                const breakpoints = this._dependencies.tryGettingBreakpointAtLocation(paused.callFrames[0].location);
                if (breakpoints.length > 0) {
                    return new HitStillPendingBreakpoint(this._eventsToClientReporter);
                }
            }

            return new PausedWhileLoadingScriptToResolveBreakpoints(this._debugeeExecutionControl);
        } else {
            return new Abstained();
        }
    }

    private async startPausingOnScriptFirstStatement(): Promise<void> {
        return this._domInstrumentationBreakpoints.setInstrumentationBreakpoint({ eventName: this.stopsWhileScriptsLoadInstrumentationName });
    }

    private async stopPausingOnScriptFirstStatement(): Promise<void> {
        return this._domInstrumentationBreakpoints.removeInstrumentationBreakpoint({ eventName: this.stopsWhileScriptsLoadInstrumentationName });
    }

    private isInstrumentationPause(notification: PausedEvent): boolean {
        return (notification.reason === 'EventListener' && notification.data.eventName.startsWith('instrumentation:')) ||
            (notification.reason === 'ambiguous' && Array.isArray(notification.data.reasons) &&
                notification.data.reasons.every((r: any) => r.reason === 'EventListener' && r.auxData.eventName.startsWith('instrumentation:')));
    }

    public async install(configuration: PauseScriptLoadsToSetBPsConfiguration): Promise<this> {
        this._dependencies.subscriberForAskForInformationAboutPaused(params => this.askForInformationAboutPaused(params));
        return await this.configure(configuration);
    }

    private async configure(configuration: PauseScriptLoadsToSetBPsConfiguration): Promise<this> {
        // TODO DIEGO: Figure out exactly when we want to block on the browser version
        // On version 69 Chrome stopped sending an extra event for DOM Instrumentation: See https://bugs.chromium.org/p/chromium/issues/detail?id=882909
        // On Chrome 68 we were relying on that event to make Break on load work on breakpoints on the first line of a file. On Chrome 69 we need an alternative way to make it work.
        this._scriptFirstStatementStopsBeforeFile = !(await configuration.debugeeVersion).browser.isAtLeastVersion(69, 0);
        return this;
    }

    constructor(
        private readonly _dependencies: PauseScriptLoadsToSetBPsDependencies,
        @inject(TYPES.IDOMInstrumentationBreakpoints) private readonly _domInstrumentationBreakpoints: IDOMInstrumentationBreakpoints,
        @inject(TYPES.IDebugeeExecutionControl) private readonly _debugeeExecutionControl: IDebugeeExecutionControl,
        @inject(TYPES.IEventsToClientReporter) protected readonly _eventsToClientReporter: IEventsToClientReporter
    ) {
    }
}