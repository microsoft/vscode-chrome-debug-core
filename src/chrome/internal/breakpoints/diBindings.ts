import { BreakpointsUpdater } from '../../internal/breakpoints/features/breakpointsUpdater';
import { SetBreakpointsRequestHandler } from '../../internal/breakpoints/features/setBreakpointsRequestHandler';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IdentifierToClassPairs, DependencyInjection, IdentifierToClassMapping } from '../../dependencyInjection.ts/di';
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
import { SourceToScriptMapper } from '../services/sourceToScriptMapper';
import { BPAtNotLoadedScriptViaHeuristicSetter } from './features/bpAtNotLoadedScriptViaHeuristicSetter';

const exportedIdentifierToClasses = new ValidatedMap<interfaces.ServiceIdentifier<any>, interfaces.Newable<any>>([
    [TYPES.ICommandHandlerDeclarer, SetBreakpointsRequestHandler]]);

const privateIdentifierToClasses: IdentifierToClassPairs = [
    [PrivateTypes.IBreakpointsUpdater, BreakpointsUpdater],
    [PrivateTypes.CurrentBPRecipeStatusRetriever, CurrentBPRecipeStatusRetriever],
    [PrivateTypes.BPRecipeStatusCalculator, BPRecipeStatusCalculator],
    [PrivateTypes.SingleBreakpointSetterWithHitCountSupport, SingleBreakpointSetterWithHitCountSupport],
    [PrivateTypes.HitCountBreakpointsSetter, HitCountBreakpointsSetter],
    [PrivateTypes.CurrentBPRecipesForSourceRegistry, BPRsDeltaCalculatorFromStoredBPRs],
    [PrivateTypes.PauseScriptLoadsToSetBPs, PauseScriptLoadsToSetBPs],
    [PrivateTypes.BreakpointsSetForScriptFinder, BreakpointsSetForScriptFinder],
];

const breakpointSubsystemIdentifierToClasses: IdentifierToClassPairs = [
    [PrivateTypes.IBreakpointsEventsListener, BreakpointsEventSystem],
    [PrivateTypes.DebuggeeBPRsSetForClientBPRFinder, DebuggeeBPRsSetForClientBPRFinder],
    [PrivateTypes.BPRecipesForSourceRetriever, BPRecipesForSourceRetriever],
    [PrivateTypes.SourceToScriptMapper, SourceToScriptMapper],
    [PrivateTypes.BPAtNotLoadedScriptViaHeuristicSetter, BPAtNotLoadedScriptViaHeuristicSetter],
    [PrivateTypes.BPRecipeAtLoadedSourceSetter, BPRecipeAtLoadedSourceSetter]];

const combinedIdentifierToClasses: IdentifierToClassPairs = [[PrivateTypes.ExistingBPsForJustParsedScriptSetter, ExistingBPsForJustParsedScriptSetter]];

export function addBreakpointsFeatureBindings(diContainer: DependencyInjection) {
    const breakpointsContainer = diContainer.configureExportedAndPrivateClasses('BreakpointsCommon', exportedIdentifierToClasses, privateIdentifierToClasses);

    const cdtpBasedBreakpointsMappings = createBreakpointsMappings(PrivateTypes.SingleBreakpointSetter);
    breakpointsContainer.configureExportedAndPrivateClasses('CDTPBasedBreakpoints', cdtpBasedBreakpointsMappings, breakpointSubsystemIdentifierToClasses);

    const hitCountBreakpointsMappings = createBreakpointsMappings(PrivateTypes.SingleBreakpointSetterForHitCountBreakpoints);
    breakpointsContainer.configureExportedAndPrivateClasses('HitCountBreakpoints', hitCountBreakpointsMappings, breakpointSubsystemIdentifierToClasses);
}

function createBreakpointsMappings(serviceName: symbol): IdentifierToClassMapping {
    const singleBreakpointSetterMapping = (<IdentifierToClassPairs>[[serviceName, SingleBreakpointSetter]])
        .concat(combinedIdentifierToClasses);
    const breakpointsExported = new ValidatedMap(singleBreakpointSetterMapping);
    return breakpointsExported;
}
