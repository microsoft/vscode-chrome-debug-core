import { BPRecipeInSource } from '../bpRecipeInSource';
import { IActionToTakeWhenPaused } from '../../features/actionToTakeWhenPaused';

export type OnPausedForBreakpointCallback = (bpRecipes: BPRecipeInSource[]) => Promise<IActionToTakeWhenPaused>;
export const defaultOnPausedForBreakpointCallback: OnPausedForBreakpointCallback = () => { throw new Error(`No callback was specified for pauses for breakpoints`); };
