/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ValidatedMap } from '../collections/validatedMap';
import { IChannelIdentifier } from './channelIdentifier';
import { getChannelName } from './channel';
import { Listeners } from './listeners';
import { PromiseOrNot } from '../utils/promises';

type ResponsesArray<T> = T extends void
    ? void
    : T[];

export type NotificationListener<Notification, Response> = (notification: Notification) => PromiseOrNot<Response>;
export type PublisherWithParamsFunction<Notification, Response> = (notification: Notification) => PromiseOrNot<ResponsesArray<Response>>;
export type PublisherFunction<Notification, Response> = Notification extends void
    ? () => PromiseOrNot<ResponsesArray<Response>>
    : PublisherWithParamsFunction<Notification, Response>;
export type SubscriberFunction<Notification, Response> = (listener: NotificationListener<Notification, Response>) => void;

// We need the template parameter to force the Communicator to be "strongly typed" from the client perspective
export class NotificationChannelIdentifier<_Notification, _Response = void> implements IChannelIdentifier {
    [Symbol.toStringTag]: 'NotificationChannelIdentifier' = 'NotificationChannelIdentifier';

    constructor(public readonly identifierSymbol: Symbol = Symbol()) { }

    public toString(): string {
        return getChannelName(this);
    }
}

class NotificationChannel<Notification, Response> {
    public readonly listeners = new Listeners<Notification, PromiseOrNot<Response>>();
    public readonly publisher: Publisher<Notification, Response> = new Publisher<Notification, Response>(this);

    constructor(public readonly identifier: NotificationChannelIdentifier<Notification, Response>) { }

    public toString(): string {
        return `${this.identifier}`;
    }
}

export class Publisher<Notification, Response> {
    constructor(private readonly notificationChannel: NotificationChannel<Notification, Response>) { }

    public async publish(notification: Notification): Promise<Response[]> {
        if (this.notificationChannel.listeners.hasListeners()) {
            return await Promise.all(this.notificationChannel.listeners.call(notification));
        } else {
            throw new Error(`Can't publish ${this.notificationChannel.identifier} because no listeners are registered`);
        }
    }

    public toString(): string {
        return `${this.notificationChannel} publisher`;
    }
}

export class NotificationsCommunicator {
    private readonly _identifierToChannel = new ValidatedMap<NotificationChannelIdentifier<any, any>, NotificationChannel<any, any>>();

    public getPublisher<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): PublisherFunction<Notification, Response> {
        const publisher = this.getChannel(notificationChannelIdentifier).publisher;
        return (notification => publisher.publish(notification)) as PublisherFunction<Notification, Response>;
    }

    public getSubscriber<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): SubscriberFunction<Notification, Response> {
        const channelListeners = this.getChannel(notificationChannelIdentifier).listeners;
        return listener => channelListeners.add(listener);
    }

    public subscribe<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>, listener: (notification: Notification) => Response): void {
        this.getChannel(notificationChannelIdentifier).listeners.add(listener);
    }

    private getChannel<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): NotificationChannel<Notification, Response> {
        return this._identifierToChannel.getOrAdd(notificationChannelIdentifier, () => new NotificationChannel<Notification, Response>(notificationChannelIdentifier));
    }
}
