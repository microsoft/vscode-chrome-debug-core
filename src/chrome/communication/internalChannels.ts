import { NotificationChannelIdentifier } from './notificationsCommunicator';
import { BPRecipie } from '../internal/breakpoints/bpRecipie';
import { ScriptOrSourceOrIdentifierOrUrlRegexp } from '../internal/locations/location';
import { registerChannels } from './channel';
import { PausedEvent } from '../target/events';
import { Vote } from './collaborativeDecision';

const _breakpoints = {
    // Notifications
    OnUnbounBPRecipieIsNowBound: new NotificationChannelIdentifier<BPRecipie<ScriptOrSourceOrIdentifierOrUrlRegexp>>(),
    OnPausedOnBreakpoint: new NotificationChannelIdentifier<PausedEvent, Vote<void>>(),
    OnNoPendingBreakpoints: new NotificationChannelIdentifier<void>(),
};

const Breakpoints: Readonly<typeof _breakpoints> = _breakpoints;

const _Internal = {
    Breakpoints,
};

export const Internal: Readonly<typeof _Internal> = _Internal;

registerChannels(Internal, 'Internal');
