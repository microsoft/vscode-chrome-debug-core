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
}

export interface NavigatedToUserRequestedUrlEventsEmitter {
    on(event: 'finishedStartingUp', listener: () => void): this;
    once(event: 'finishedStartingUp', listener: () => void): this;
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

    private subscribeToAllNestedEmitters(event: string, listener: Function): void {
        for (const nestedEventEmitter of this._nestedEmitters) {
            nestedEventEmitter.on(event as any, listener as any);
        }
    }

    public on(event: string, listener: Function): this {
        super.on(event, listener);
        this.subscribeToAllNestedEmitters(event, listener);
        return this;
    }
}

/* Use to track the time executing each step during launch
    The report/telemetry generated looks like this:
        All	5271.022216 // Time since the reporter is created (which is basically when we launched the debug adapter itself) until we navigated to the user's web page
        BeforeFirstStep	[7.833247] // Time since the reporter is created (which is basically when we launched the debug adapter itself) until we get the first request
        ClientRequest.initialize	[1.261372] // Time we spent processing the initialize request
        WaitingAfter.ClientRequest.initialize	[74.939561] // Time we spent after processing the initialize request for the client to send us another request
        ClientRequest.launch	[2.748096] // Time we spent processing the first part of the launch request until we actually start launching the target debugee .exe
        LaunchTarget.LaunchExe	[10.276666] // The time it takes to spawn the  the target debugee .exe (We launch the .exe but we don't wait for it)
        Attach	[0.731042] // Time spent in general attach logic
        Attach.RequestDebuggerTargetsInformation	[511.098151] // Time we spend requesting the targets from the debugee using the /json/list endpoint
        Attach.ProcessDebuggerTargetsInformation	[1.270085] // Time we spend processing the HTTP response from  /json/list endpoint
        Attach.AttachToTargetDebuggerWebsocket	[5.268137] // Time we spend attaching to the websocket
        Attach.ConfigureDebuggingSession.Internal	[0.486761] // After we connected to the websocket, time we spent initializing our internal configuration
        Attach.ConfigureDebuggingSession.Target	[18.861989] // After we connected to the websocket, time we spent configuring the target, enabling domains, getting schemas, etc...
        WaitingAfter.ClientRequest.launch	[17.472918] // Time we spent after processing the launch request for the client to send us another request
        ClientRequest.setBreakpoints	[3.708698] // Time we spent processing the set breakpoints request
        WaitingAfter.ClientRequest.setBreakpoints	[0.343137] // Time we spent after processing the setBreakpoints request for the client to send us another request
        ClientRequest.setExceptionBreakpoints	[0.927851] // Time we spent processing the set exception breakpoints request
        WaitingAfter.ClientRequest.setExceptionBreakpoints	[245.659565] // Time we spent after processing the set exception breakpoints request for the client to send us another request
        ClientRequest.configurationDone	[0.326911] // Time we spend in the configuration done request before asking the target to navigate to the user's page
        ConfigureTarget.RequestNavigateToUserPage	[0.529427] // Time we spend requesting the debugee target to navigate to the user's page (we don't wait for it to do it, just to ACK it)
        WaitingAfter.ClientRequest.configurationDone	[4367.064368] // Time we spend waiting for another request (This is normally the time it takes the debugee target to navigate to the user's web page, probably due to the web server taking time to answer)
        steps	["BeforeFirstStep","ClientRequest.initialize","WaitingAfter.ClientRequest.initialize","ClientRequest.launch","LaunchTarget.LaunchExe","Attach",
            "Attach.RequestDebuggerTargetsInformation","Attach.ProcessDebuggerTargetsInformation","Attach.AttachToTargetDebuggerWebsocket","Attach.ConfigureDebuggingSession.Internal",
            "Attach.ConfigureDebuggingSession.Target","WaitingAfter.ClientRequest.launch","ClientRequest.setBreakpoints","WaitingAfter.ClientRequest.setBreakpoints",
            "ClientRequest.setExceptionBreakpoints","WaitingAfter.ClientRequest.setExceptionBreakpoints","ClientRequest.configurationDone","ConfigureTarget.RequestNavigateToUserPage",
            "WaitingAfter.ClientRequest.configurationDone"] // The order in which steps were recorder during this execution
 */

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
