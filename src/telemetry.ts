/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {OutputEvent} from 'vscode-debugadapter';
import { fillErrorDetails } from './utils';

export type ExceptionType = 'uncaughtException' | 'unhandledRejection' | 'firstChance';
export interface  IExecutionResultTelemetryProperties {
    // There is an issue on some clients and reportEvent only currently accept strings properties,
    // hence all the following properties must be strings.
    successful?: 'true' | 'false';
    exceptionType?: ExceptionType;
    exceptionMessage?: string;
    exceptionName?: string;
    exceptionStack?: string;
    startTime?: string;
    timeTakenInMilliseconds?: string;
}

export interface ITelemetryReporter {
    reportEvent(name: string, data?: any): void;
    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void;
}

export class TelemetryReporter implements ITelemetryReporter {
    private _sendEvent: (event: DebugProtocol.Event) => void;
    private _globalTelemetryProperties: any = {};

    reportEvent(name: string, data?: any): void {
        if (this._sendEvent) {
            const combinedData = Object.assign({}, this._globalTelemetryProperties, data);
            const event = new OutputEvent(name, 'telemetry', combinedData);
            this._sendEvent(event);
        }
    }

    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void {
        this._sendEvent = _sendEvent;
    }

    public addCustomGlobalProperty(additionalGlobalTelemetryProperties: any): void {
        Object.assign(this._globalTelemetryProperties, additionalGlobalTelemetryProperties);
    }
}

// If you add an async global property, all events after that will include it
export class AsyncGlobalPropertiesTelemetryReporter implements ITelemetryReporter {
    private _actionsQueue = Promise.resolve() as Promise<any>;

    constructor(private _telemetryReporter: TelemetryReporter) {
        // We just store the parameter
    }

    public reportEvent(name: string, data?: any): void {
        this._actionsQueue = this._actionsQueue.then(() => // We block the report event until all the addCustomGlobalProperty have finished
            this._telemetryReporter.reportEvent(name, data));
    }

    public setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void {
        this._telemetryReporter.setupEventHandler(_sendEvent);
    }

    public addCustomGlobalProperty(additionalGlobalPropertiesPromise: Promise<any> | any): void {
        const reportedPropertyP = Promise.resolve(additionalGlobalPropertiesPromise).then(
            property => this._telemetryReporter.addCustomGlobalProperty(property),
            rejection => this.reportErrorWhileWaitingForProperty(rejection));
        this._actionsQueue = Promise.all([this._actionsQueue, reportedPropertyP]);
    }

    private reportErrorWhileWaitingForProperty(rejection: any): void {
        let properties: IExecutionResultTelemetryProperties = {};
        properties.successful = 'false';
        properties.exceptionType = 'firstChance';
        fillErrorDetails(properties, rejection);
        this._telemetryReporter.reportEvent("error-while-adding-custom-global-property", properties);
    }
}

export class NullTelemetryReporter implements ITelemetryReporter {
    reportEvent(name: string, data?: any): void {
        // no-op
    }

    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void {
        // no-op
    }

}

export const DefaultTelemetryIntervalInMilliseconds = 10000;

export class BatchTelemetryReporter {
    private _eventBuckets: {[eventName: string]: any};
    private _timer: NodeJS.Timer;

    public constructor(private _telemetryReporter: ITelemetryReporter, private _cadenceInMilliseconds: number = DefaultTelemetryIntervalInMilliseconds) {
        this.reset();
        this.setup();
    }

    public reportEvent(name: string, data?: any): void {
        if (!this._eventBuckets[name]) {
            this._eventBuckets[name] = [];
        }

        this._eventBuckets[name].push(data);
    }

    public finalize(): void {
        this.send();
        clearInterval(this._timer);
    }

    private setup(): void {
        this._timer = setInterval(() => this.send(), this._cadenceInMilliseconds);
    }

    private reset(): void {
        this._eventBuckets = {};
    }

    private send(): void {
        for (const eventName in this._eventBuckets) {
            const bucket = this._eventBuckets[eventName];
            let properties = BatchTelemetryReporter.transfromBucketData(bucket);
            this._telemetryReporter.reportEvent(eventName, properties);
        }

        this.reset();
    }
    /**
     * Transfrom the bucket of events data from the form:
     * [{
     *  p1: v1,
     *  p2: v2
     * },
     * {
     *  p1: w1,
     *  p2: w2
     *  p3: w3
     * }]
     *
     * to
     * {
     *   p1: [v1,   w1],
     *   p2: [v2,   w2],
     *   p3: [null, w3]
     * }
     *
     *
     * The later form is easier for downstream telemetry analysis.
     */
    private static transfromBucketData(bucketForEventType: any[]): {[groupedPropertyValue: string]: string} {
        const allPropertyNamesInTheBucket = BatchTelemetryReporter.collectPropertyNamesFromAllEvents(bucketForEventType);
        let properties = {};

        // Create a holder for all potential property names.
        for (const key of allPropertyNamesInTheBucket) {
            properties[`aggregated.${key}`] = [];
        }

        // Run through all the events in the bucket, collect the values for each property name.
        for (const event of bucketForEventType) {
            for (const propertyName of allPropertyNamesInTheBucket) {
                properties[`aggregated.${propertyName}`].push(event[propertyName] === undefined ? null : event[propertyName]);
            }
        }

        // Serialize each array as the final aggregated property value.
        for (const propertyName of allPropertyNamesInTheBucket) {
            properties[`aggregated.${propertyName}`] = JSON.stringify(properties[`aggregated.${propertyName}`]);
        }

        return properties;
    }

    /**
     * Get the property keys from all the entries of a event bucket:
     *
     * So
     * [{
     *  p1: v1,
     *  p2: v2
     * },
     * {
     *  p1: w1,
     *  p2: w2
     *  p3: w3
     * }]
     *
     * will return ['p1', 'p2', 'p3']
     */
    private static collectPropertyNamesFromAllEvents(bucket: any[]): string[] {
        let propertyNamesSet = {};
        for (const entry of bucket) {
            for (const key of Object.keys(entry)) {
                propertyNamesSet[key] = true;
            }
        }
        return Object.keys(propertyNamesSet);
    }
}

export const telemetry = new AsyncGlobalPropertiesTelemetryReporter(new TelemetryReporter());