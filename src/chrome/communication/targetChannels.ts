import { ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { NotificationChannelIdentifier } from './notificationsCommunicator';
import { Breakpoint } from '../internal/breakpoints/breakpoint';
import { ScriptParsedEvent, PausedEvent } from '../target/events';
import { registerChannels } from './channel';

const _debugger = {
    // Notifications
    OnAsyncBreakpointResolved: new NotificationChannelIdentifier<Breakpoint<ScriptOrSourceOrIdentifierOrUrlRegexp>>(),
    OnScriptParsed: new NotificationChannelIdentifier<ScriptParsedEvent>(),
    OnPaused: new NotificationChannelIdentifier<PausedEvent, void>(),
    OnResumed: new NotificationChannelIdentifier<void, void>(),
};

const Debugger: Readonly<typeof _debugger> = _debugger;

const _Target = {
    Debugger,
};

export const Target: Readonly<typeof _Target> = _Target;

registerChannels(Target, 'Target');
