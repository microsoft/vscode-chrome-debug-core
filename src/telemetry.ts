/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { OutputEvent } from 'vscode-debugadapter';
import { fillErrorDetails } from './utils';
import { isDefined } from './chrome/utils/typedOperators';

/* __GDPR__FRAGMENT__
   "IExecutionResultTelemetryProperties" : {
        "successful" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
        "exceptionType" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
        "exceptionMessage" : { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
        "exceptionName" : { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
        "exceptionStack" : { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
        "exceptionId" : { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
        "startTime" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
        "timeTakenInMilliseconds" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
   }
 */
export type ExceptionType = 'uncaughtException' | 'unhandledRejection' | 'firstChance';
export interface  IExecutionResultTelemetryProperties {
    // There is an issue on some clients and reportEvent only currently accept strings properties,
    // hence all the following properties must be strings.
    successful?: 'true' | 'false';
    exceptionType?: ExceptionType;
    exceptionMessage?: string;
    exceptionName?: string;
    exceptionStack?: string;
    exceptionId?: string;
    startTime?: string;
    timeTakenInMilliseconds?: string;
}

export interface ITelemetryReporter {
    reportEvent(name: string, data?: any): void;
    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void;
    addCustomGlobalProperty(additionalGlobalTelemetryProperties: any): void;
}

export class TelemetryReporter implements ITelemetryReporter {
    private _sendEvent: ((event: DebugProtocol.Event) => void) | undefined = undefined;
    private _globalTelemetryProperties: any = {};

    reportEvent(name: string, data?: any): void {
        if (isDefined(this._sendEvent)) {
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
        /*
         * TODO: Put this code back after VS stops dropping telemetry events that happen after fatal errors, and disconnecting...
         * VS has a bug where it drops telemetry events that happen after a fatal error, or after the DA starts disconnecting. Our
         * temporary workaround is to make telemetry sync, so it'll likely be sent before we send the fatal errors, etc...
        this._actionsQueue = this._actionsQueue.then(() => // We block the report event until all the addCustomGlobalProperty have finished
            this._telemetryReporter.reportEvent(name, data));
         */
        this._telemetryReporter.reportEvent(name, data);
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

        /* __GDPR__
           "error-while-adding-custom-global-property" : {
             "${include}": [
                 "${IExecutionResultTelemetryProperties}"
             ]
           }
         */
        this._telemetryReporter.reportEvent('error-while-adding-custom-global-property', properties);
    }
}

export class NullTelemetryReporter implements ITelemetryReporter {
    reportEvent(_name: string, _data?: any): void {
        // no-op
    }

    setupEventHandler(_sendEvent: (event: DebugProtocol.Event) => void): void {
        // no-op
    }
    addCustomGlobalProperty(_additionalGlobalTelemetryProperties: any): void {
        // no-op
    }
}

export const DefaultTelemetryIntervalInMilliseconds = 10000;

export class BatchTelemetryReporter {
    private _eventBuckets: {[eventName: string]: any} = {};
    private _timer = this.setupTimer();

    public constructor(private _telemetryReporter: ITelemetryReporter, private _cadenceInMilliseconds: number = DefaultTelemetryIntervalInMilliseconds) {
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
        let propertiesAsArray: {[groupedPropertyValue: string]: string[]} = {};

        // Create a holder for all potential property names.
        for (const key of allPropertyNamesInTheBucket) {
            propertiesAsArray[`aggregated.${key}`] = [];
        }

        // Run through all the events in the bucket, collect the values for each property name.
        for (const event of bucketForEventType) {
            for (const propertyName of allPropertyNamesInTheBucket) {
                propertiesAsArray[`aggregated.${propertyName}`].push(event[propertyName] === undefined ? null : event[propertyName]);
            }
        }

        let properties: {[groupedPropertyValue: string]: string} = {};

        // Serialize each array as the final aggregated property value.
        for (const propertyName of allPropertyNamesInTheBucket) {
            properties[`aggregated.${propertyName}`] = JSON.stringify(propertiesAsArray[`aggregated.${propertyName}`]);
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
        let propertyNamesSet: {[property: string]: boolean} = {};
        for (const entry of bucket) {
            for (const key of Object.keys(entry)) {
                propertyNamesSet[key] = true;
            }
        }
        return Object.keys(propertyNamesSet);
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

    private setupTimer(): NodeJS.Timer {
        return setInterval(() => this.send(), this._cadenceInMilliseconds);
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
}

export interface ITelemetryPropertyCollector {
    getProperties(): {[propertyName: string]: string};
    addTelemetryProperty(propertyName: string, value: string): void;
}

export class TelemetryPropertyCollector implements ITelemetryPropertyCollector {
    private _properties: {[propertyName: string]: string} = {};

    public getProperties() {
        return this._properties;
    }

    public addTelemetryProperty(propertyName: string, value: string) {
        this._properties[propertyName] = value;
    }
}

export const telemetry: ITelemetryReporter = new AsyncGlobalPropertiesTelemetryReporter(new TelemetryReporter());