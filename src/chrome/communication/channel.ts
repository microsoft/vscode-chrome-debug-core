/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { RequestChannelIdentifier } from './requestsCommunicator';
import { NamespaceReverseLookupCreator, NamespaceTree } from '../utils/namespaceReverseLookupCreator';
import { NotificationChannelIdentifier } from './notificationsCommunicator';
import { IChannelIdentifier } from './channelIdentifier';

type ChannelIdentifierNamespace = NamespaceTree<IChannelIdentifier>;

const registeredChannels: ChannelIdentifierNamespace = {};
export function registerChannels(channel: ChannelIdentifierNamespace, name: string): void {
    registeredChannels[name] = channel;
}

let channelToNameMapping: Map<IChannelIdentifier, string> | null = null;

function isChannelIdentifier(obj: any): obj is IChannelIdentifier {
    return obj instanceof NotificationChannelIdentifier || obj instanceof RequestChannelIdentifier;
}

export function getChannelName(channel: IChannelIdentifier): string {
    if (channelToNameMapping === null) {
        channelToNameMapping = new NamespaceReverseLookupCreator(registeredChannels, isChannelIdentifier, '').create();
    }

    return channelToNameMapping.get(channel);
}
