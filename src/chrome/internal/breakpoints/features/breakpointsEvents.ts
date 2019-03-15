/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { NotificationChannelIdentifier } from '../../../communication/notificationsCommunicator';
import { registerChannels } from '../../../communication/channel';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { CDTPBPRecipe, CDTPBreakpoint } from '../../../cdtpDebuggee/cdtpPrimitives';
import { BPRecipeIsUnbound } from '../bpRecipeStatusForRuntimeLocation';

const _breakpointsEvents = {
    OnClientBPRecipeAdded: new NotificationChannelIdentifier<BPRecipeInSource>(),
    OnClientBPRecipeRemoved: new NotificationChannelIdentifier<BPRecipeInSource>(),
    OnDebuggeeBPRecipeAdded: new NotificationChannelIdentifier<CDTPBPRecipe>(),
    OnDebuggeeBPRecipeRemoved: new NotificationChannelIdentifier<CDTPBPRecipe>(),
    OnBreakpointIsBound: new NotificationChannelIdentifier<CDTPBreakpoint>(),
    OnBPRecipeIsUnboundForRuntimeSource: new NotificationChannelIdentifier<BPRecipeIsUnbound>(),
};

export const BreakpointsEvents: Readonly<typeof _breakpointsEvents> = _breakpointsEvents;
registerChannels(BreakpointsEvents, 'BreakpointsEvents');
