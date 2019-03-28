import { BreakpointsUpdater } from '../../internal/breakpoints/features/breakpointsUpdater';
import { SetBreakpointsRequestHandler } from '../../internal/breakpoints/features/setBreakpointsRequestHandler';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IdentifierToClassPairs, DependencyInjection } from '../../dependencyInjection.ts/di';
import { ValidatedMap } from '../../collections/validatedMap';
import { interfaces } from 'inversify';
import { BPRecipeStatusCalculator } from './registries/bpRecipeStatusCalculator';
import { BPRecipeAtLoadedSourceSetter } from './features/bpRecipeAtLoadedSourceLogic';
import { BreakpointsEventSystem } from './features/breakpointsEventSystem';
import { PrivateTypes } from './diTypes';
import { DebuggeeBPRsSetForClientBPRFinder } from './registries/debuggeeBPRsSetForClientBPRFinder';

const exportedIdentifierToClasses: IdentifierToClassPairs = [
    [TYPES.IBreakpointsUpdater, BreakpointsUpdater],
    [TYPES.ICommandHandlerDeclarer, SetBreakpointsRequestHandler]];

const privatedentifierToClasses = new ValidatedMap<interfaces.ServiceIdentifier<any>, interfaces.Newable<any>>([
    [PrivateTypes.BPRecipeStatusCalculator, BPRecipeStatusCalculator],
    [PrivateTypes.IBreakpointsEventsListener, BreakpointsEventSystem],
    [PrivateTypes.DebuggeeBPRsSetForClientBPRFinder, DebuggeeBPRsSetForClientBPRFinder],
    [PrivateTypes.BPRecipeAtLoadedSourceSetter, BPRecipeAtLoadedSourceSetter]]);

export function addBreakpointsFeatureBindings(diContainer: DependencyInjection) {
    diContainer.configureExportedAndPrivateClasses('Breakpoints', exportedIdentifierToClasses, privatedentifierToClasses);
}