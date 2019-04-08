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
import { HitCountBreakpointsSetter } from './features/hitCountBreakpointsSetter';
import { SingleBreakpointSetter } from './features/singleBreakpointSetter';
import { SingleBreakpointSetterWithHitCountSupport } from './features/singleBreakpointSetterWithHitCountSupport';
import { CurrentBPRecipeStatusRetriever } from './registries/currentBPRecipeStatusRetriever';
import { ExistingBPsForJustParsedScriptSetter } from './features/existingBPsForJustParsedScriptSetter';
import { BPRsDeltaCalculatorFromStoredBPRs } from './registries/bprsDeltaCalculatorFromStoredBPRs';
import { BreakpointsSetForScriptFinder } from './registries/breakpointsSetForScriptFinder';
import { PauseScriptLoadsToSetBPs } from './features/pauseScriptLoadsToSetBPs';
import { BPRecipesForSourceRetriever } from './registries/bpRecipesForSourceRetriever';

const exportedIdentifierToClasses = new ValidatedMap<interfaces.ServiceIdentifier<any>, interfaces.Newable<any>>([
    [TYPES.IBreakpointsUpdater, BreakpointsUpdater],
    [TYPES.ICommandHandlerDeclarer, SetBreakpointsRequestHandler]]);

const privatedentifierToClasses: IdentifierToClassPairs = [
    [PrivateTypes.BPRecipeStatusCalculator, BPRecipeStatusCalculator],
    [PrivateTypes.SingleBreakpointSetter, SingleBreakpointSetter],
    [PrivateTypes.SingleBreakpointSetterWithHitCountSupport, SingleBreakpointSetterWithHitCountSupport],
    [PrivateTypes.CurrentBPRecipeStatusRetriever, CurrentBPRecipeStatusRetriever],
    [PrivateTypes.IBreakpointsEventsListener, BreakpointsEventSystem],
    [PrivateTypes.DebuggeeBPRsSetForClientBPRFinder, DebuggeeBPRsSetForClientBPRFinder],
    [PrivateTypes.HitCountBreakpointsSetter, HitCountBreakpointsSetter],
    [PrivateTypes.BreakpointsSetForScriptFinder, BreakpointsSetForScriptFinder],
    [PrivateTypes.BPRecipesForSourceRetriever, BPRecipesForSourceRetriever],
    [PrivateTypes.PauseScriptLoadsToSetBPs, PauseScriptLoadsToSetBPs],
    [PrivateTypes.CurrentBPRecipesForSourceRegistry, BPRsDeltaCalculatorFromStoredBPRs],
    [PrivateTypes.ExistingBPsForJustParsedScriptSetter, ExistingBPsForJustParsedScriptSetter],
    [PrivateTypes.BPRecipeAtLoadedSourceSetter, BPRecipeAtLoadedSourceSetter]];

export function addBreakpointsFeatureBindings(diContainer: DependencyInjection) {
    const breakpointsContainer = diContainer.configureExportedAndPrivateClasses('Breakpoints', exportedIdentifierToClasses, privatedentifierToClasses);

    const hitCountBreakpointsExported = new ValidatedMap([[PrivateTypes.SingleBreakpointSetterForHitCountBreakpoints, SingleBreakpointSetter]]);
    breakpointsContainer.configureExportedAndPrivateClasses('HitCountBreakpoints', hitCountBreakpointsExported, privatedentifierToClasses);
}
