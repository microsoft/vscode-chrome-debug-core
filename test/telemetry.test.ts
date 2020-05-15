/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import { TelemetryReporter, IExecutionResultTelemetryProperties } from '../src/telemetry';

suite('telemetry', () => {
    test('remaps exception keys', callback => {
        const reporter = new TelemetryReporter();
        reporter.setupEventHandler(event => {
            callback();

            assert.deepStrictEqual(event, {
                successful: 'false',
                exceptionType: 'uncaughtException',
                '!exceptionMessage': 'some error',
                exceptionName: 'SomeError',
                '!exceptionStack': 'foo.js:123',
            });
        });

        reporter.reportEvent('error', {
            successful: 'false',
            exceptionType: 'uncaughtException',
            exceptionMessage: 'some error',
            exceptionName: 'SomeError',
            exceptionStack: 'foo.js:123',
        } as IExecutionResultTelemetryProperties);
    });
});
