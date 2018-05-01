/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { CRDPMultiplexor } from '../../../src/chrome/crdpMultiplexing/crdpMultiplexor';
import { LikeSocket } from 'noice-json-rpc';
import { Mock, Times, It, IMock } from 'typemoq';
import * as Assert from 'assert';

class StubSocket implements LikeSocket {

    send(message: string): void { /* empty */ }
    removeListener(event: string, cb: Function): any { /* empty */ }
    on(event: 'open', cb: (ws: LikeSocket) => void): any;
    on(event: 'message', cb: (data: string) => void): any;
    on(event: string, cb: Function): any { /* empty */ }
}

suite('CRDPMultiplexor', () => {

    let multiplexor: CRDPMultiplexor;
    let webSocketMock: IMock<StubSocket>;
    let socketMessageCallbacks: Function[];

    setup(() => {
        let socket = new StubSocket();
        socketMessageCallbacks = [];
        webSocketMock = Mock.ofInstance<StubSocket>(socket);
        webSocketMock
            .setup(s => s.on('message', It.isAny()))
            .returns((s: string, cb: any) => {
                socketMessageCallbacks.push(cb);
            });
        webSocketMock
            .setup(s => s.send(It.isAnyString()))
            .returns((s: string) => {
                let message = JSON.parse(s);
                for (let cb of socketMessageCallbacks) {
                    // Send empty result once we received a message
                    cb('{"id":' + message.id + ', "result":{}}');
                }
            });
        multiplexor = new CRDPMultiplexor(webSocketMock.object);
    });

    teardown(() => {
        multiplexor = undefined;
        webSocketMock.reset();
        webSocketMock = undefined;
        socketMessageCallbacks = [];
    });

    test('Channel is successfully added', done => {
        let testChannel = multiplexor.addChannel('testChannel');
        Assert.notEqual(testChannel, null, 'Test channel should not be null');
        done();
    });

    test('Multiplexor message sent to underlying socket and response received.', done => {
        let channel = multiplexor.addChannel('testChannel');
        let messageId = 1;
        let channelCallback = (data: string) => {
            // Test receiving data - called when socket sends back response data
            Assert.equal(JSON.parse(data).id, messageId);
            done();
        };

        // Test sending data
        channel.on('message', channelCallback);
        multiplexor.send(channel, '{"method":"Runtime.enable","id":' + messageId + '}');
        webSocketMock.verify(s => s.send(It.isAnyString()), Times.atLeastOnce());
    });

    test('Multiplexor message handles multiple channels', () => {
        let callbackPromises: Promise<void>[] = [];

        /**
         * Used for generating message ids such that we test messages on different channels
         * using the same id.
         */
        let getMessageIdForIndex = (i: number) => {
            if (i <= 5) {
                return i;
            } else {
                return i % 2;
            }
        };

        for (let i = 1; i < 10; i++) {
            let channel = multiplexor.addChannel('Channel' + i);

            let callbackPromise = new Promise<void>((resolve, reject) => {
                let callback = (data: string) => {
                    Assert.equal(JSON.parse(data).id, getMessageIdForIndex(i));
                    resolve();
                };

                channel.on('message', callback);
            });

            callbackPromises.push(callbackPromise);
            multiplexor.send(channel, '{"method":"Console.enable","id":' + getMessageIdForIndex(i) + '}');
        }

        // wait for all promises
        return Promise.all(callbackPromises);
    });

    test('Multiplexor notification delivered to all channels', () => {
        let callbackPromises: Promise<void>[] = [];
        let testNotification = 'Test.notification';
        let testEnable = 'Test.enable';

        for (let i = 1; i < 5; i++) {
            let channel = multiplexor.addChannel('Channel' + i);

            let callbackPromise = new Promise<void>((resolve, reject) => {
                let callback = (data: string) => {
                    let notification = JSON.parse(data);
                    if (notification.id !== undefined) {
                        // first callback is the response to test.enable
                        Assert.equal(notification.id, i);
                    } else {
                        // second callback is the Test.notification callback
                        Assert.equal(notification.method, testNotification);
                        resolve();
                    }
                };

                channel.on('message', callback);
            });

            // Enable the Test domain so we will receive notifications
            channel.send('{"method":"' + testEnable + '","id":' + i + '}');
            callbackPromises.push(callbackPromise);
        }

        // send a notification to the socket message callbacks
        Assert.equal(socketMessageCallbacks.length, 1);
        socketMessageCallbacks[0]('{"method":"' + testNotification + '"}');

        // wait for all promises
        return Promise.all(callbackPromises);
    });

    test('Notifications are delayed until domain is enabled', done => {
        let domain1Enable = 'Domain1.enable';
        let domain2Enable = 'Domain2.enable';
        let domain1Notification = 'Domain1.notification';
        let domain2Notification = 'Domain2.notification';

        let receivedMessages = [];
        let expectedMessages = [
            '{"id":1,"result":{}}',
            '{"method":"Domain1.notification"}',
            '{"id":2,"result":{}}',
            '{"method":"Domain2.notification"}'];

        let channel = multiplexor.addChannel('channel');
        channel.on('message', (data: string) => {
            receivedMessages.push(data);
        });

        // Enable the first domain so we will receive notifications
        channel.send('{"method":"' + domain1Enable + '","id":1}');

        // send both notifications, we should only receive one
        Assert.equal(socketMessageCallbacks.length, 1);
        socketMessageCallbacks[0]('{"method":"' + domain1Notification + '"}');
        socketMessageCallbacks[0]('{"method":"' + domain2Notification + '"}');

        // Enable the second domain - we should get the pending notification
        channel.send('{"method":"' + domain2Enable + '","id":2}');
        Assert.deepEqual(receivedMessages, expectedMessages);
        done();

    });
});
