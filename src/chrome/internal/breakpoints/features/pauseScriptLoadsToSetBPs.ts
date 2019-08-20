/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IInstallableComponent } from '../../features/components';
import { BaseNotifyClientOfPause, IActionToTakeWhenPaused, NoActionIsNeededForThisPause, BasePauseShouldBeAutoResumed } from '../../features/actionToTakeWhenPaused';
import { ReasonType } from '../../../stoppedEvent';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { IDebuggeeExecutionController } from '../../../cdtpDebuggee/features/cdtpDebugeeExecutionController';
import { ExistingBPsForJustParsedScriptSetter } from './existingBPsForJustParsedScriptSetter';
import { BreakpointsSetForScriptFinder } from '../registries/breakpointsSetForScriptFinder';
import { IDOMInstrumentationBreakpointsSetter } from '../../../cdtpDebuggee/features/cdtpDOMInstrumentationBreakpointsSetter';
import { IDebuggeeRuntimeVersionProvider } from '../../../cdtpDebuggee/features/cdtpDebugeeRuntimeVersionProvider';
import { PausedEvent } from '../../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { wrapWithMethodLogger } from '../../../logging/methodsCalledLogger';
import { IDebuggeePausedHandler } from '../../features/debuggeePausedHandler';
import { injectable, inject, multiInject } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { printClassDescription } from '../../../utils/printing';
import { PrivateTypes } from '../diTypes';
import { DoNotLog } from '../../../logging/decorators';
import { BPRecipeInSourceWasResolved } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { asyncMap } from '../../../collections/async';

@printClassDescription
export class HitStillPendingBreakpoint extends BaseNotifyClientOfPause {
    protected reason: ReasonType = 'breakpoint';

    constructor(protected readonly _eventsToClientReporter: IEventsToClientReporter) {
        super();
    }
}

@printClassDescription
export class PausedWhileLoadingScriptToResolveBreakpoints extends BasePauseShouldBeAutoResumed {
    constructor(protected readonly _debuggeeExecutionControl: IDebuggeeExecutionController) {
        super();
    }
}

export enum WhenWasEnabled {
    JustEnabled,
    AlreadyEnabled
}

/// TODO: Move this to a browser-shared package
/**
 * Pause the scripts after they are parsed, so we have time to set all the breakpoint recipes for that script before resuming the execution,
 * thus eliminating the race condition we'd have without this feature, and warranting that all breakpoint recipes for a source will be hit
 * (Currently this only works for scripts that are added to the DOM)
 */
@injectable()
export class PauseScriptLoadsToSetBPs implements IInstallableComponent {
    private readonly stopsWhileScriptsLoadInstrumentationName = 'scriptFirstStatement';
    private _isInstrumentationEnabled = false;
    private _scriptFirstStatementStopsBeforeFile = false;

    public readonly withLogging = wrapWithMethodLogger(this);

    constructor(
        @inject(TYPES.IDebuggeePausedHandler) private readonly _debuggeePausedHandler: IDebuggeePausedHandler,
        @inject(TYPES.IDOMInstrumentationBreakpointsSetter) private readonly _domInstrumentationBreakpoints: IDOMInstrumentationBreakpointsSetter,
        @inject(TYPES.IDebuggeeExecutionController) private readonly _debugeeExecutionControl: IDebuggeeExecutionController,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter,
        @inject(TYPES.IDebuggeeRuntimeVersionProvider) private readonly _debugeeVersionProvider: IDebuggeeRuntimeVersionProvider,
        @multiInject(PrivateTypes.ExistingBPsForJustParsedScriptSetter) private readonly _existingBPsForJustParsedScriptSetters: ExistingBPsForJustParsedScriptSetter[],
        @inject(PrivateTypes.BreakpointsSetForScriptFinder) private readonly _breakpointsSetForScriptFinder: BreakpointsSetForScriptFinder,
    ) {
        this._debuggeePausedHandler.registerActionProvider(paused => this.withLogging.onProvideActionForWhenPaused(paused));
    }

    public bpRecipeIsResolved(bpRecipeWasResolved: BPRecipeInSourceWasResolved): void {
        this._breakpointsSetForScriptFinder.bpRecipeIsResolved(bpRecipeWasResolved);
    }

    public async enableIfNeccesary(): Promise<WhenWasEnabled> {
        if (this._isInstrumentationEnabled === false) {
            await this.startPausingOnScriptFirstStatement();
            return WhenWasEnabled.JustEnabled;
        } else {
            return WhenWasEnabled.AlreadyEnabled;
        }
    }

    // TODO: Figure out if and when we can disable break on load for performance reasons
    public async disableIfNeccesary(): Promise<void> {
        if (this._isInstrumentationEnabled === true) {
            await this.stopPausingOnScriptFirstStatement();
        }
    }

    @DoNotLog()
    private async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        if (this.isInstrumentationPause(paused)) {
            await asyncMap(this._existingBPsForJustParsedScriptSetters, setter => setter.waitUntilBPsAreSet(paused.callFrames[0].location.script));

            // If we pause before starting the script, we can just resume, and we'll a breakpoint if it's on 0,0
            if (!this._scriptFirstStatementStopsBeforeFile) {
                // On Chrome 69 we pause inside the script, so we need to check if there is a breakpoint at 0,0 that we need to use
                const breakpoints = this._breakpointsSetForScriptFinder.tryGettingBreakpointAtLocation(paused.callFrames[0].location);
                if (breakpoints.length > 0) {
                    return new HitStillPendingBreakpoint(this._eventsToClientReporter);
                }
            }

            return new PausedWhileLoadingScriptToResolveBreakpoints(this._debugeeExecutionControl);
        } else {
            return new NoActionIsNeededForThisPause(this);
        }
    }

    private async startPausingOnScriptFirstStatement(): Promise<void> {
        try {
            this._isInstrumentationEnabled = true;
            await this._domInstrumentationBreakpoints.setInstrumentationBreakpoint({ eventName: this.stopsWhileScriptsLoadInstrumentationName });
        } catch (exception) {
            this._isInstrumentationEnabled = false;
            throw exception;
        }
    }

    private async stopPausingOnScriptFirstStatement(): Promise<void> {
        await this._domInstrumentationBreakpoints.removeInstrumentationBreakpoint({ eventName: this.stopsWhileScriptsLoadInstrumentationName });
        this._isInstrumentationEnabled = false;
    }

    private isInstrumentationPause(notification: PausedEvent): boolean {
        return (notification.reason === 'EventListener' && notification.data.eventName.startsWith('instrumentation:')) ||
            (notification.reason === 'ambiguous' && Array.isArray(notification.data.reasons) &&
                notification.data.reasons.every((r: any) => r.reason === 'EventListener' && r.auxData.eventName.startsWith('instrumentation:')));
    }

    public async install(): Promise<this> {
        // TODO DIEGO: Figure out exactly when we want to block on the browser version
        // On version 69 Chrome stopped sending an extra event for DOM Instrumentation: See https://bugs.chromium.org/p/chromium/issues/detail?id=882909
        // On Chrome 68 we were relying on that event to make Break on load work on breakpoints on the first line of a file. On Chrome 69 we need an alternative way to make it work.
        // TODO: Reenable the code that uses Versions.Target.Version when this fails
        const runtimeVersion = await this._debugeeVersionProvider.version();
        this._scriptFirstStatementStopsBeforeFile = !runtimeVersion.isAtLeastVersion('69.0.0');
        return this;
    }

    public toString(): string {
        return 'PauseScriptLoadsToSetBPs';
    }
}