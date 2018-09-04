/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { HighResTimer, calculateElapsedTime } from './utils';
import { EventEmitter } from 'events';

export type TimingsReport = {[stepName: string]: [number] | number};

export const stepStartedEventName = 'stepStarted';
export const milestoneReachedEventName = 'milestoneReached';
export const stepCompletedEventName = 'stepCompleted';
export const requestCompletedEventName = 'requestCompleted';

export interface IStepStartedEventArguments {
    stepName: string;
}

export interface IMilestoneReachedEventArguments {
    milestoneName: string;
}

export interface IStepCompletedEventArguments {
    stepName: string;
}

export interface IRequestCompletedEventArguments {
    requestName: string;
    startTime: number;
    timeTakenInMilliseconds: number;
}

export interface IObservableEvents<T> { // T is an interface that declares the on methods (listeners) that we can subscribe to
    events: T;
}

export interface IStepStartedEventsEmitter {
    on(event: 'stepStarted', listener: (args: IStepStartedEventArguments) => void): this;
    on(event: 'milestoneReached', listener: (args: IMilestoneReachedEventArguments) => void): this;
    removeListener(event: 'stepStarted', listener: (args: IStepStartedEventArguments) => void): this;
    removeListener(event: 'milestoneReached', listener: (args: IMilestoneReachedEventArguments) => void): this;
}

export interface FinishedStartingUpEventArguments {
    requestedContentWasDetected: boolean;
    reasonForNotDetected: string;
}

export interface IFinishedStartingUpEventsEmitter {
    on(event: 'finishedStartingUp', listener: (args: FinishedStartingUpEventArguments) => void): this;
    once(event: 'finishedStartingUp', listener: (args: FinishedStartingUpEventArguments) => void): this;
    removeListener(event: 'finishedStartingUp', listener: () => void): this;
    removeListener(event: 'finishedStartingUp', listener: () => void): this;
}

export class StepProgressEventsEmitter extends EventEmitter implements IStepStartedEventsEmitter, IFinishedStartingUpEventsEmitter {
    constructor(private readonly _nestedEmitters: IStepStartedEventsEmitter[] = [] as IStepStartedEventsEmitter[]) {
        super();
    }

    public emitStepStarted(stepName: string): void {
        this.emit(stepStartedEventName, { stepName: stepName } as IStepStartedEventArguments);
    }

    public emitMilestoneReached(milestoneName: string): void {
        this.emit(milestoneReachedEventName, { milestoneName: milestoneName } as IMilestoneReachedEventArguments);
    }

    public emitStepCompleted(stepName: string): void {
        this.emit(stepCompletedEventName, { stepName: stepName } as IStepCompletedEventArguments);
    }

    public emitRequestCompleted(requestName: string, requestStartTime: number, timeTakenByRequestInMilliseconds: number): void {
        this.emit(requestCompletedEventName, { requestName: requestName, startTime: requestStartTime, timeTakenInMilliseconds: timeTakenByRequestInMilliseconds } as IRequestCompletedEventArguments);
    }

    public on(event: string, listener: (...args: any[]) => void): this {
        super.on(event, listener);
        this._nestedEmitters.forEach(nestedEmitter => nestedEmitter.on(event as any, listener as any));
        return this;
    }

    public removeListener(event: string, listener: (...args: any[]) => void): this {
        super.removeListener(event, listener);
        this._nestedEmitters.forEach(nestedEmitter => nestedEmitter.removeListener(event as any, listener as any));
        return this;
    }
}

class SubscriptionManager {
    private _removeSubscriptionActions = [] as (() => void)[];

    public on(eventEmitter: EventEmitter, event: string | symbol, listener: (...args: any[]) => void): void {
        eventEmitter.on(event, listener);
        this._removeSubscriptionActions.push(() => eventEmitter.removeListener(event, listener));
    }

    public removeAll(): void {
        for (const removeSubscriptionAction of this._removeSubscriptionActions) {
            removeSubscriptionAction();
        }

        this._removeSubscriptionActions = [] as (() => void)[];
    }
}

export interface IAllRequestProperties {
    [propertyName: string]: number[];
}

export class ExecutionTimingsReporter {
    private readonly _allStartTime: HighResTimer;
    private readonly _eventsExecutionTimesInMilliseconds: {[stepName: string]: [number]} = {};
    private readonly _stepsList = [] as string[];
    private readonly _subscriptionManager = new SubscriptionManager();
    private readonly _requestProperties = {} as IAllRequestProperties;

    private _currentStepStartTime: HighResTimer;

    /* __GDPR__FRAGMENT__
       "StepNames" : {
          "BeforeFirstStep" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
       }
     */
    private _currentStepName = 'BeforeFirstStep';

    constructor() {
        this._currentStepStartTime = this._allStartTime = process.hrtime();
    }

    private recordPreviousStepAndConfigureNewStep(newStepName: string): void {
        this.recordTimeTaken(this._currentStepName, this._currentStepStartTime);
        this._stepsList.push(this._currentStepName);
        this._currentStepStartTime = process.hrtime();
        this._currentStepName = newStepName;
    }

    private recordTimeTaken(eventName: string, sinceWhen: HighResTimer): void {
        const timeTakenInMilliseconds = calculateElapsedTime(sinceWhen);
        this.addElementToArrayProperty(this._eventsExecutionTimesInMilliseconds, eventName, timeTakenInMilliseconds);
    }

    private recordTotalTimeUntilMilestone(milestoneName: string): void {
        this.recordTimeTaken(milestoneName, this._allStartTime);
    }

    public generateReport(): {[stepName: string]: [number] | number} {
        /* __GDPR__FRAGMENT__
           "StepNames" : {
              "AfterLastStep" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
           }
         */
        this.recordPreviousStepAndConfigureNewStep('AfterLastStep');
        this._subscriptionManager.removeAll(); // Remove all subscriptions so we don't get any new events

        /* __GDPR__FRAGMENT__
           "ReportProps" : {
              "Steps" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
              "All" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
              "${wildcard}": [
                 {
                    "${prefix}": "Request.",
                    "${classification}": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
                 }
              ],
              "${include}": [ "${RequestProperties}", "${StepNames}" ]
           }
         */
        return Object.assign({},
            {
                Steps: this._stepsList,
                All: calculateElapsedTime(this._allStartTime)
            },
            this._requestProperties,
            this._eventsExecutionTimesInMilliseconds);
    }

    public recordRequestCompleted(requestName: string, startTime: number, timeTakenInMilliseconds: number): void {
        /* __GDPR__FRAGMENT__
           "RequestProperties" : {
              "${wildcard}": [
                 {
                    "${prefix}": "Request.",
                    "${classification}": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
                 }
              ]
           }
         */
        const propertyPrefix = `Request.${requestName}.`;
        this.addElementToArrayProperty(this._requestProperties, propertyPrefix + 'startTime', startTime);
        this.addElementToArrayProperty(this._requestProperties, propertyPrefix + 'timeTakenInMilliseconds', timeTakenInMilliseconds);
    }

    private addElementToArrayProperty<T>(object: {[propertyName: string]: T[]}, propertyName: string, elementToAdd: T): void {
        const propertiesArray = object[propertyName] = object[propertyName] || [] as T[];
        propertiesArray.push(elementToAdd);
    }

    public subscribeTo(eventEmitter: EventEmitter): void {
        this._subscriptionManager.on(eventEmitter, stepStartedEventName, (args: IStepStartedEventArguments) => {
            this.recordPreviousStepAndConfigureNewStep(args.stepName);
        });

        this._subscriptionManager.on(eventEmitter, milestoneReachedEventName, (args: IMilestoneReachedEventArguments) => {
            this.recordTotalTimeUntilMilestone(args.milestoneName);
        });

        this._subscriptionManager.on(eventEmitter, stepCompletedEventName, (args: IStepCompletedEventArguments) => {
            /* __GDPR__FRAGMENT__
               "StepNames" : {
                  "${wildcard}": [
                     {
                        "${prefix}": "WaitingAfter",
                        "${classification}": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
                     }
                  ]
               }
             */
            this.recordTotalTimeUntilMilestone(`WaitingAfter.${args.stepName}`);
        });

        this._subscriptionManager.on(eventEmitter, requestCompletedEventName, (args: IRequestCompletedEventArguments) => {
            this.recordRequestCompleted(args.requestName, args.startTime, args.timeTakenInMilliseconds);
        });
    }
}
