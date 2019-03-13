/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { NotificationsCommunicator, NotificationChannelIdentifier, PublisherFunction, SubscriberFunction, PublisherWithParamsFunction } from './notificationsCommunicator';
import { RequestsCommunicator, RequestChannelIdentifier, RequestHandlerCallback } from './requestsCommunicator';
import { IExecutionLogger } from '../logging/executionLogger';
import { PromiseOrNot } from '../utils/promises';

export interface ICommunicator {
    getPublisher<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): PublisherFunction<Notification, Response>;
    getSubscriber<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): SubscriberFunction<Notification, Response>;
    subscribe<Notification>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification>, listener: (notification: Notification) => void): void;
    registerHandler<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>, handler: (request: Request) => PromiseOrNot<Response>): void;
    getRequester<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>): RequestHandlerCallback<Request, Response>;
}

/**
 * Small strongly typed event-dispatcher system
 */
export class Communicator implements ICommunicator {
    private readonly _notificationsCommunicator = new NotificationsCommunicator();
    private readonly _requestsCommunicator = new RequestsCommunicator();

    public getPublisher<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): PublisherFunction<Notification, Response> {
        return this._notificationsCommunicator.getPublisher(notificationChannelIdentifier);
    }

    public getSubscriber<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): SubscriberFunction<Notification, Response> {
        return this._notificationsCommunicator.getSubscriber(notificationChannelIdentifier);
    }

    public subscribe<Notification>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification>, listener: (notification: Notification) => void): void {
        return this._notificationsCommunicator.subscribe(notificationChannelIdentifier, listener);
    }

    public registerHandler<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>, handler: (request: Request) => PromiseOrNot<Response>): void {
        this._requestsCommunicator.registerHandler(requestChannelIdentifier, handler);
    }

    public getRequester<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>): RequestHandlerCallback<Request, Response> {
        return this._requestsCommunicator.getRequester(requestChannelIdentifier);
    }
}

export class LoggingCommunicator implements ICommunicator {
    constructor(private readonly _wrappedCommunicator: ICommunicator, private readonly _logger: IExecutionLogger) { }

    public getPublisher<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): PublisherFunction<Notification, Response> {
        const publisher = this._wrappedCommunicator.getPublisher(notificationChannelIdentifier) as PublisherWithParamsFunction<Notification, Response>;
        return (notification => {
            return this._logger.logAsyncFunctionCall(`Communicator\\Publish: ${notificationChannelIdentifier}`, publisher, notification);
        }) as PublisherFunction<Notification, Response>;
    }

    public getRequester<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>): RequestHandlerCallback<Request, Response> {
        const requester = this._wrappedCommunicator.getRequester(requestChannelIdentifier);
        return ((request) => {
            return this._logger.logAsyncFunctionCall(`Communicator\\Request: ${requestChannelIdentifier}`, requester, request);
        }) as RequestHandlerCallback<Request, Response>;
    }

    public getSubscriber<Notification, Response>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification, Response>): SubscriberFunction<Notification, Response> {
        return this._wrappedCommunicator.getSubscriber(notificationChannelIdentifier);
    }

    public subscribe<Notification>(notificationChannelIdentifier: NotificationChannelIdentifier<Notification>, listener: (notification: Notification) => void): void {
        this._wrappedCommunicator.subscribe(notificationChannelIdentifier, listener);
    }

    public registerHandler<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>, handler: (request: Request) => Response): void {
        this._wrappedCommunicator.registerHandler(requestChannelIdentifier, handler);
    }
}
