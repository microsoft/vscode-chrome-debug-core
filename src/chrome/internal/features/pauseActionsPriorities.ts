/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { IActionToTakeWhenPaused } from './actionToTakeWhenPaused';
import { ShouldStepInToAvoidSkippedSource } from './smartStep';
import { HitBreakpoint, NoRecognizedBreakpoints } from '../breakpoints/features/bpRecipeAtLoadedSourceLogic';
import { HitStillPendingBreakpoint, PausedWhileLoadingScriptToResolveBreakpoints } from '../breakpoints/features/pauseScriptLoadsToSetBPs';
import { ExceptionWasThrown, PromiseWasRejected, PromiseWasRejectedWithFeatureTurnedOff } from '../exceptions/pauseOnException';
import { HitAndSatisfiedHitCountBreakpoint, HitCountBreakpointWhenConditionWasNotSatisfied } from '../breakpoints/features/hitCountBreakpointsSetter';
import { FinishedStepping, UserPaused } from '../stepping/features/syncStepping';
import { PausedBecauseAsyncCallWasScheduled } from '../stepping/features/asyncStepping';

export type ActionToTakeWhenPausedClass = { new(...args: any[]): IActionToTakeWhenPaused };

export const actionsFromHighestToLowestPriority: ActionToTakeWhenPausedClass[] = [
    ShouldStepInToAvoidSkippedSource, // Stepping in to avoid a skipped source takes preference over hitting breakpoints, even user pausing, etc...

    UserPaused, // The user requesting to pause takes preferences over everything else

    HitAndSatisfiedHitCountBreakpoint,
    HitBreakpoint,
    HitStillPendingBreakpoint,
    ExceptionWasThrown,
    PromiseWasRejected,

    PausedBecauseAsyncCallWasScheduled,

    FinishedStepping,

    PausedWhileLoadingScriptToResolveBreakpoints,

    HitCountBreakpointWhenConditionWasNotSatisfied,

    NoRecognizedBreakpoints,

    PromiseWasRejectedWithFeatureTurnedOff,
];
