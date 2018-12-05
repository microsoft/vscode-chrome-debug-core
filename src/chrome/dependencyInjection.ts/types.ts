import 'reflect-metadata';

const TYPES = {
    ISession: Symbol.for('ISession'),
    communicator: Symbol.for('communicator'),
    chromeConnectionApi: Symbol.for('chromeConnection.api'),
    IDOMInstrumentationBreakpoints: Symbol.for('IDOMInstrumentationBreakpoints'),
    IEventsToClientReporter: Symbol.for('IEventsToClientReporter'),
    IDebugeeExecutionControl: Symbol.for('IDebugeeExecutionControl'),
    IPauseOnExceptions: Symbol.for('IPauseOnExceptions'),
    IBreakpointFeaturesSupport: Symbol.for('IBreakpointFeaturesSupport'),
    IAsyncDebuggingConfiguration: Symbol.for('IAsyncDebuggingConfiguration'),
    IStackTracePresentationLogicProvider: Symbol.for('IStackTracePresentationLogicProvider'),
    IScriptSources: Symbol.for('IScriptSources'),
    EventsConsumedByConnectedCDA: Symbol.for('EventsConsumedByConnectedCDA'),
    IDebugeeLauncher: Symbol.for('IDebugeeLauncher'),
    CrdpApi: Symbol.for('CrdpApi'),
    CDTPStackTraceParser: Symbol.for('CDTPStackTraceParser'),
    CDTPLocationParser: Symbol.for('CDTPLocationParser'),
};

export { TYPES };
