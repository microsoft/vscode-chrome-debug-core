import { CDTPDebuggeeExecutionController } from './features/cdtpDebugeeExecutionController';
import { CDTPDebuggeeStateInspector } from './features/cdtpDebugeeStateInspector';
import { CDTPDebuggeeStateSetter } from './features/cdtpDebugeeStateSetter';
import { CDTPDebuggeeExecutionEventsProvider } from './eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { CDTPDebuggeeRuntimeVersionProvider } from './features/cdtpDebugeeRuntimeVersionProvider';
import { CDTPDebuggeeBreakpointsSetter } from './features/cdtpDebuggeeBreakpointsSetter';
import { CDTPDebuggeeSteppingController } from './features/cdtpDebugeeSteppingController';
import { CDTPDOMInstrumentationBreakpointsSetter } from './features/cdtpDOMInstrumentationBreakpointsSetter';
import { CDTPAsyncDebuggingConfigurer } from './features/cdtpAsyncDebuggingConfigurer';
import { CDTPScriptSourcesRetriever } from './features/cdtpScriptSourcesRetriever';
import { CDTPScriptsRegistry } from './registries/cdtpScriptsRegistry';
import { CDTPBreakpointFeaturesSupport } from '../cdtpDebuggee/features/cdtpBreakpointFeaturesSupport';
import { CDTPExceptionThrownEventsProvider } from '../cdtpDebuggee/eventsProviders/cdtpExceptionThrownEventsProvider';
import { CDTPExecutionContextEventsProvider } from '../cdtpDebuggee/eventsProviders/cdtpExecutionContextEventsProvider';
import { CDTPOnScriptParsedEventProvider } from '../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';
import { CDTPBrowserNavigator } from '../cdtpDebuggee/features/cdtpBrowserNavigator';
import { CDTPLogEventsProvider } from '../cdtpDebuggee/eventsProviders/cdtpLogEventsProvider';
import { CDTPConsoleEventsProvider } from '../cdtpDebuggee/eventsProviders/cdtpConsoleEventsProvider';
import { CDTPPauseOnExceptionsConfigurer } from '../cdtpDebuggee/features/cdtpPauseOnExceptionsConfigurer';
import { CDTPBlackboxPatternsConfigurer } from '../cdtpDebuggee/features/cdtpBlackboxPatternsConfigurer';
import { CDTPDomainsEnabler } from '../cdtpDebuggee/infrastructure/cdtpDomainsEnabler';
import { LoadedSourcesRegistry } from '../cdtpDebuggee/registries/loadedSourcesRegistry';
import { CDTPRuntimeStarter } from '../cdtpDebuggee/features/cdtpRuntimeStarter';
import { CDTPPausedOverlayConfigurer } from '../cdtpDebuggee/features/cdtpPausedOverlayConfigurer';
import { CDTPSchemaProvider } from '../cdtpDebuggee/features/cdtpSchemaProvider';
import { ValidatedMap } from '../collections/validatedMap';
import { TYPES } from '../dependencyInjection.ts/types';
import { interfaces } from 'inversify';
import { DependencyInjection } from '../dependencyInjection.ts/di';
import { CDTPNetworkCacheConfigurer } from './features/cdtpNetworkCacheConfigurer';
import { getSourceTextRetrievability } from '../internal/sources/sourceTextRetriever';

const exportedIdentifierToClassMapping = new ValidatedMap<symbol, interfaces.Newable<any> | Function>([
    [TYPES.IDebuggeeExecutionController, CDTPDebuggeeExecutionController],
    [TYPES.IDebuggeeStateInspector, CDTPDebuggeeStateInspector],
    [TYPES.IUpdateDebuggeeState, CDTPDebuggeeStateSetter],
    [TYPES.ICDTPDebuggeeExecutionEventsProvider, CDTPDebuggeeExecutionEventsProvider],
    [TYPES.IDebuggeeRuntimeVersionProvider, CDTPDebuggeeRuntimeVersionProvider],
    [TYPES.IDebuggeeBreakpointsSetter, CDTPDebuggeeBreakpointsSetter],
    [TYPES.IDebuggeeSteppingController, CDTPDebuggeeSteppingController],
    [TYPES.IDOMInstrumentationBreakpointsSetter, CDTPDOMInstrumentationBreakpointsSetter],
    [TYPES.IAsyncDebuggingConfiguration, CDTPAsyncDebuggingConfigurer],
    [TYPES.IScriptSources, CDTPScriptSourcesRetriever],
    [TYPES.GetSourceTextRetrievability, getSourceTextRetrievability],
    [TYPES.CDTPScriptsRegistry, CDTPScriptsRegistry],
    [TYPES.IPauseOnExceptions, CDTPPauseOnExceptionsConfigurer],
    [TYPES.IBreakpointFeaturesSupport, CDTPBreakpointFeaturesSupport],
    [TYPES.ExceptionThrownEventProvider, CDTPExceptionThrownEventsProvider],
    [TYPES.ExecutionContextEventsProvider, CDTPExecutionContextEventsProvider],
    [TYPES.IBrowserNavigation, CDTPBrowserNavigator],
    [TYPES.IScriptParsedProvider, CDTPOnScriptParsedEventProvider],
    [TYPES.IConsoleEventsProvider, CDTPConsoleEventsProvider],
    [TYPES.ILogEventsProvider, CDTPLogEventsProvider],
    [TYPES.IBlackboxPatternsConfigurer, CDTPBlackboxPatternsConfigurer],
    [TYPES.IDomainsEnabler, CDTPDomainsEnabler],
    [TYPES.IRuntimeStarter, CDTPRuntimeStarter],
    [TYPES.IPausedOverlayConfigurer, CDTPPausedOverlayConfigurer],
    [TYPES.INetworkCacheConfiguration, CDTPNetworkCacheConfigurer],
    [TYPES.ISchemaProvider, CDTPSchemaProvider],
]);

const privateIdentifierToClassMapping = new ValidatedMap<interfaces.Newable<any>, interfaces.Newable<any>>([
    [CDTPScriptsRegistry, CDTPScriptsRegistry],
    [LoadedSourcesRegistry, LoadedSourcesRegistry],
]);

export function addCDTPBindings(diContainer: DependencyInjection): void {
    diContainer.configureExportedAndPrivateClasses('CDTP', exportedIdentifierToClassMapping, privateIdentifierToClassMapping);
}
