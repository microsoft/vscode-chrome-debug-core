/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { BPRecipeInSource } from '../bpRecipeInSource';
import { IActionToTakeWhenPaused } from '../../features/actionToTakeWhenPaused';
import { InternalError } from '../../../utils/internalError';

export type OnPausedForBreakpointCallback = (bpRecipes: BPRecipeInSource[]) => Promise<IActionToTakeWhenPaused>;
export const defaultOnPausedForBreakpointCallback: OnPausedForBreakpointCallback = () => { throw new InternalError('error.pauseForBPPause.noCallback', 'No callback was specified for pauses for breakpoints'); };
