import { ValidatedMap } from '../../collections/validatedMap';
import { IActionToTakeWhenPaused } from './actionToTakeWhenPaused';

export type ActionToTakeWhenPausedClass = { new(...args: any[]): IActionToTakeWhenPaused };

const actionsFromHighestToLowestPriority: ActionToTakeWhenPausedClass[] = [
    // TODO: Fill these after we merge the files
];

const priorityIndexAndActionClassPairs = actionsFromHighestToLowestPriority.map((situationClass, index) => <[ActionToTakeWhenPausedClass, number]>[situationClass, index]);
export const actionClassToPriorityIndexMapping = new ValidatedMap(priorityIndexAndActionClassPairs);
