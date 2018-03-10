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

export interface StepStartedEventArguments {
    stepName: string;
}

export interface MilestoneReachedEventArguments {
    milestoneName: string;
}

export interface StepCompletedEventArguments {
    stepName: string;
}

export interface RequestCompletedEventArguments {
    requestName: string;
    startTime: number;
    timeTakenInMilliseconds: number;
}

export interface ObservableEvents<T> { // T is an interface that declares the on methods (listeners) that we can subscribe to
    events: T;
}

export interface StepStartedEventsEmitter {
    on(event: 'stepStarted', listener: (args: StepStartedEventArguments) => void): this;
    on(event: 'milestoneReached', listener: (args: MilestoneReachedEventArguments) => void): this;
    removeListener(event: 'stepStarted', listener: (args: StepStartedEventArguments) => void): this;
    removeListener(event: 'milestoneReached', listener: (args: MilestoneReachedEventArguments) => void): this;
}

export interface NavigatedToUserRequestedUrlEventsEmitter {
    on(event: 'finishedStartingUp', listener: () => void): this;
    once(event: 'finishedStartingUp', listener: () => void): this;
    removeListener(event: 'finishedStartingUp', listener: () => void): this;
    removeListener(event: 'finishedStartingUp', listener: () => void): this;
}

export class StepProgressEventsEmitter extends EventEmitter {
    constructor(private readonly _nestedEmitters: [StepStartedEventsEmitter] = [] as [StepStartedEventsEmitter]) {
        super();
    }

    public emitStepStarted(stepName: string): void {
        this.emit(stepStartedEventName, { stepName: stepName } as StepStartedEventArguments);
    }

    public emitMilestoneReached(milestoneName: string): void {
        this.emit(milestoneReachedEventName, { milestoneName: milestoneName } as MilestoneReachedEventArguments);
    }

    public emitStepCompleted(stepName: string): void {
        this.emit(stepCompletedEventName, { stepName: stepName } as StepCompletedEventArguments);
    }

    public emitRequestCompleted(requestName: string, requestStartTime: number, timeTakenByRequestInMilliseconds: number): void {
        this.emit(requestCompletedEventName, { requestName: requestName, startTime: requestStartTime, timeTakenInMilliseconds: timeTakenByRequestInMilliseconds } as RequestCompletedEventArguments);
    }

    public on(event: string, listener: Function): this {
        super.on(event, listener);
        this._nestedEmitters.forEach(nestedEmitter => nestedEmitter.on(event as any, listener as any));
        return this;
    }

    public removeListener(event: string, listener: Function): this {
        super.removeListener(event, listener);
        this._nestedEmitters.forEach(nestedEmitter => nestedEmitter.removeListener(event as any, listener as any));
        return this;
    }
}

class SubscriptionManager {
    private _removeSubscriptionActions = [] as [() => void];

    public on(eventEmitter: EventEmitter, event: string | symbol, listener: Function): void {
        eventEmitter.on(event, listener);
        this._removeSubscriptionActions.push(() => eventEmitter.removeListener(event, listener));
    }

    public removeAll(): void {
        for (const removeSubscriptionAction of this._removeSubscriptionActions) {
            removeSubscriptionAction();
        }

        this._removeSubscriptionActions = [] as [() => void];
    }
}

export interface AllRequestProperties {
    [propertyName: string]: string[];
}

export class ExecutionTimingsReporter {
    private readonly _allStartTime: HighResTimer;
    private readonly _eventsExecutionTimesInMilliseconds: {[stepName: string]: [number]} = {};
    private readonly _stepsList = [] as [string];
    private readonly _subscriptionManager = new SubscriptionManager();
    private readonly _requestProperties = {} as AllRequestProperties;

    private _currentStepStartTime: HighResTimer;
    private _currentStepName = "BeforeFirstStep";

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
        this.recordPreviousStepAndConfigureNewStep("AfterLastStep");
        this._subscriptionManager.removeAll(); // Remove all subscriptions so we don't get any new events
        return Object.assign({}, { steps: this._stepsList, all: calculateElapsedTime(this._allStartTime) }, this._requestProperties, this._eventsExecutionTimesInMilliseconds);
    }

    public recordRequestCompleted(requestName: string, startTime: number, timeTakenInMilliseconds: number) {
        const propertyPrefix = `Request.${requestName}.`;
        this.addElementToArrayProperty(this._requestProperties, propertyPrefix + "startTime", startTime.toString());
        this.addElementToArrayProperty(this._requestProperties, propertyPrefix + "timeTakenInMilliseconds", timeTakenInMilliseconds.toString());
    }

    private addElementToArrayProperty<T>(object: {[propertyName: string]: T[]}, propertyName: string, elementToAdd: T): void {
        const propertiesArray = object[propertyName] = object[propertyName] || [] as T[];
        propertiesArray.push(elementToAdd);
    }

    public subscribeTo(eventEmitter: EventEmitter): void {
        this._subscriptionManager.on(eventEmitter, stepStartedEventName, (args: StepStartedEventArguments) => {
            this.recordPreviousStepAndConfigureNewStep(args.stepName);
        });

        this._subscriptionManager.on(eventEmitter, milestoneReachedEventName, (args: MilestoneReachedEventArguments) => {
            this.recordTotalTimeUntilMilestone(args.milestoneName);
        });

        this._subscriptionManager.on(eventEmitter, stepCompletedEventName, (args: StepCompletedEventArguments) => {
            this.recordTotalTimeUntilMilestone(`WaitingAfter.${args.stepName}`);
        });

        this._subscriptionManager.on(eventEmitter, requestCompletedEventName, (args: RequestCompletedEventArguments) => {
            this.recordRequestCompleted(args.requestName, args.startTime, args.timeTakenInMilliseconds);
        });
    }
}
