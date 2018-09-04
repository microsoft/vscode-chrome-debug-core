import { RequestChannelIdentifier } from './requestsCommunicator';
import { NamespaceReverseLookupCreator, NamespaceTree } from '../utils/namespaceReverseLookupCreator';
import { NotificationChannelIdentifier } from './notificationsCommunicator';
import { ChannelIdentifier } from './channelIdentifier';

type ChannelIdentifierNamespace = NamespaceTree<ChannelIdentifier>;

const registeredChannels: ChannelIdentifierNamespace = {};
export function registerChannels(channel: ChannelIdentifierNamespace, name: string): void {
    registeredChannels[name] = channel;
}

let channelToNameMapping: Map<ChannelIdentifier, string> | null = null;

function isChannelIdentifier(obj: any): obj is ChannelIdentifier {
    return obj instanceof NotificationChannelIdentifier || obj instanceof RequestChannelIdentifier;
}

export function getChannelName(channel: ChannelIdentifier): string {
    if (channelToNameMapping === null) {
        channelToNameMapping = new NamespaceReverseLookupCreator(registeredChannels, isChannelIdentifier, '').create();
    }

    return channelToNameMapping.get(channel);
}
