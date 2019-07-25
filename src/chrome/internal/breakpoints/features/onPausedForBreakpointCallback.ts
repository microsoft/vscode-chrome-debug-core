/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { BPRecipeInSource } from '../bpRecipeInSource';
import { IActionToTakeWhenPaused } from '../../features/actionToTakeWhenPaused';

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

export type OnPausedForBreakpointCallback = (bpRecipes: BPRecipeInSource[]) => Promise<IActionToTakeWhenPaused>;
export const defaultOnPausedForBreakpointCallback: OnPausedForBreakpointCallback = () => { throw new Error(localize('error.pauseForBPPause.noCallback', 'No callback was specified for pauses for breakpoints')); };
