import { ValidatedMap } from '../collections/validatedMap';
import { ChannelIdentifier } from './channelIdentifier';
import { getChannelName } from './channel';
import { PromiseOrNot } from '../utils/promises';

export type RequestHandlerCallback<Request, Response> =
    Request extends void
    ? () => Promise<Response> :
    NonVoidRequestHandler<Request, Response>;

export type NonVoidRequestHandler<Request, Response> = (request: Request) => Promise<Response>;

// We need the template parameter to force the Communicator to be "strongly typed" from the client perspective
export class RequestChannelIdentifier<_Request, _Response> implements ChannelIdentifier {
    [Symbol.toStringTag]: 'RequestChannelIdentifier' = 'RequestChannelIdentifier';

    constructor(public readonly identifierSymbol: Symbol = Symbol()) { }

    public toString(): string {
        return getChannelName(this);
    }
}

interface RequestHandler<Request, Response> {
    isRegistered(): boolean;
    call(request: Request): Promise<Response>;
}

class NoRegisteredRequestHandler<Request, Response> implements RequestHandler<Request, Response> {
    public isRegistered(): boolean {
        return false;
    }

    public call(request: Request): Promise<Response> {
        throw new Error(`Can't execute request <${request}> because no handler has yet registered to handle requests for channel <${this._channel}>`);
    }

    constructor(private readonly _channel: RequestChannel<Request, Response>) { }
}

class RegisteredRequestHandler<Request, Response> implements RequestHandler<Request, Response> {
    public isRegistered(): boolean {
        return true;
    }

    public call(request: Request): Promise<Response> {
        return (this._callback as NonVoidRequestHandler<Request, Response>)(request);
    }

    constructor(private readonly _callback: RequestHandlerCallback<Request, Response>) { }
}

class RequestChannel<Request, Response> {
    public readonly requester: Requester<Request, Response> = new Requester<Request, Response>(this);
    public handler: RequestHandler<Request, Response> = new NoRegisteredRequestHandler(this);

    public toString(): string {
        return `#${this._identifier}`;
    }

    constructor(private readonly _identifier: RequestChannelIdentifier<Request, Response>) { }
}

export class Requester<Request, Response> {
    constructor(private readonly _requestChannel: RequestChannel<Request, Response>) { }

    public request(request: Request): Promise<Response> {
        return this._requestChannel.handler.call(request);
    }
}

export class RequestsCommunicator {
    private readonly _identifierToChannel = new ValidatedMap<RequestChannelIdentifier<any, any>, RequestChannel<any, any>>();

    public registerHandler<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>,
        handler: (request: Request) => PromiseOrNot<Response>): void {
        const existingHandler = this.getChannel(requestChannelIdentifier).handler;
        if (!existingHandler.isRegistered()) {
            this.getChannel(requestChannelIdentifier).handler = new RegisteredRequestHandler(handler as RequestHandlerCallback<Request, Response>);
        } else {
            throw new Error(`Can't register a handler for ${requestChannelIdentifier} because a handler has already been registered (${existingHandler})`);
        }
    }

    public getRequester<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>): RequestHandlerCallback<Request, Response> {
        const requester = this.getChannel(requestChannelIdentifier).requester;
        return ((request: Request) => requester.request(request)) as RequestHandlerCallback<Request, Response>;
    }

    private getChannel<Request, Response>(requestChannelIdentifier: RequestChannelIdentifier<Request, Response>): RequestChannel<Request, Response> {
        return this._identifierToChannel.getOrAdd(requestChannelIdentifier, () => new RequestChannel<Request, Response>(requestChannelIdentifier));
    }
}
