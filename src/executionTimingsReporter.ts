import { HighResTimer, calculateElapsedTime } from "./utils";
import { EventEmitter } from "events";

export type TimingsReport = {[stepName: string]: [number] | number};

const stepStartedEventName = 'stepStarted';
const milestoneReachedEventName = 'milestoneReached';

interface StepStartedEventArguments {
    stepName: string;
}

interface MilestoneReachedEventArguments {
    milestoneName: string;
}

export interface ObservableEvents {
    Events: EventEmitter;
}

export class StepProgressEventsEmitter extends EventEmitter {
    constructor(public readonly NestedEmitters: [EventEmitter] = [] as [EventEmitter]) {
        super();
    }

    public emitStepStarted(stepName: string): void {
        this.emit(stepStartedEventName, { stepName: stepName } as StepStartedEventArguments);
    }

    public emitMilestoneReached(milestoneName: string): void {
        this.emit(milestoneReachedEventName, { milestoneName: milestoneName } as MilestoneReachedEventArguments);
    }

}

export function subscribeIncludingNestedEmitters(eventEmitter: EventEmitter, event: string | symbol, listener: Function): void {
    eventEmitter.on(event, listener);

    if (eventEmitter instanceof StepProgressEventsEmitter) {
        for (const nestedEventEmitter of eventEmitter.NestedEmitters) {
            subscribeIncludingNestedEmitters(nestedEventEmitter, event, listener);
        }
    }
}

/* Use to track the time executing each step during launch
    Usage:
        this.Events.emitStepStarted("Attach");
        this.Events.emitStepStarted("Attach.AttachToTargetDebuggerWebsocket");
        this.Events.emitStepStarted("ClientRequest.setBreakpoints");
        this.Events.emitStepStarted("WaitingAfter.ClientRequest.setBreakpoints");
        this.Events.emitStepStarted("ClientRequest.setBreakpoints");
        this.Events.emitStepStarted("WaitingAfter.ClientRequest.setBreakpoints");
        reporter.generateReport() // Returns the report. Do not call any more methods after this

    The report/telemetry generated looks like this:
        All	5271.022216 // Time since the reporter is created (which is basically when we launched the debug adapter itself) until we navigated to the user's web page
        BeforeFirstStep	7.833247 // Time since the reporter is created (which is basically when we launched the debug adapter itself) until we get the first request
        ClientRequest.initialize	[1.261372] // Time we spent processing the initialize request
        WaitingAfter.ClientRequest.initialize	[74.939561] // Time we spent after processing the initialize request for the client to send us another request
        ClientRequest.launch	[2.748096] // Time we spent processing the first part of the launch request until we actually start launching the target debugee .exe
        LaunchTarget.LaunchExe	10.276666 // The time it takes to spawn the  the target debugee .exe (We launch the .exe but we don't wait for it)
        Attach	0.731042 // Time spent in general attach logic
        Attach.RequestDebuggerTargetsInformation	[511.098151] // Time we spend requesting the targets from the debugee using the /json/list endpoint
        Attach.ProcessDebuggerTargetsInformation	[1.270085] // Time we spend processing the HTTP response from  /json/list endpoint
        Attach.AttachToTargetDebuggerWebsocket	5.268137 // Time we spend attaching to the websocket
        Attach.ConfigureDebuggingSession.Internal	0.486761 // After we connected to the websocket, time we spent initializing our internal configuration
        Attach.ConfigureDebuggingSession.Target	18.861989 // After we connected to the websocket, time we spent configuring the target, enabling domains, getting schemas, etc...
        WaitingAfter.ClientRequest.launch	[17.472918] // Time we spent after processing the launch request for the client to send us another request
        ClientRequest.setBreakpoints	[3.708698] // Time we spent processing the set breakpoints request
        WaitingAfter.ClientRequest.setBreakpoints	[0.343137] // Time we spent after processing the setBreakpoints request for the client to send us another request
        ClientRequest.setExceptionBreakpoints	[0.927851] // Time we spent processing the set exception breakpoints request
        WaitingAfter.ClientRequest.setExceptionBreakpoints	[245.659565] // Time we spent after processing the set exception breakpoints request for the client to send us another request
        ClientRequest.configurationDone	[0.326911] // Time we spend in the configuration done request before asking the target to navigate to the user's page
        ConfigureTarget.RequestNavigateToUserPage	0.529427 // Time we spend requesting the debugee target to navigate to the user's page (we don't wait for it to do it, just to ACK it)
        WaitingAfter.ClientRequest.configurationDone	[4367.064368] // Time we spend waiting for another request (This is normally the time it takes the debugee target to navigate to the user's web page, probably due to the web server taking time to answer)
        steps	["BeforeFirstStep","ClientRequest.initialize","WaitingAfter.ClientRequest.initialize","ClientRequest.launch","LaunchTarget.LaunchExe","Attach",
            "Attach.RequestDebuggerTargetsInformation","Attach.ProcessDebuggerTargetsInformation","Attach.AttachToTargetDebuggerWebsocket","Attach.ConfigureDebuggingSession.Internal",
            "Attach.ConfigureDebuggingSession.Target","WaitingAfter.ClientRequest.launch","ClientRequest.setBreakpoints","WaitingAfter.ClientRequest.setBreakpoints",
            "ClientRequest.setExceptionBreakpoints","WaitingAfter.ClientRequest.setExceptionBreakpoints","ClientRequest.configurationDone","ConfigureTarget.RequestNavigateToUserPage",
            "WaitingAfter.ClientRequest.configurationDone"] // The order in which steps were recorder during this execution
 */

export class ExecutionTimingsReporter {
    private readonly _allStartTime: HighResTimer;
    private readonly _eventsExecutionTimesInMilliseconds: {[stepName: string]: [number]} = {};
    private readonly _stepsList = [] as [string];

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
        const executionTimes = this._eventsExecutionTimesInMilliseconds[eventName] = this._eventsExecutionTimesInMilliseconds[eventName] || [] as [number];
        executionTimes.push(timeTakenInMilliseconds);
    }

    private recordTotalTimeUntilMilestone(milestoneName: string): void {
        this.recordTimeTaken(milestoneName, this._allStartTime);
    }

    public generateReport(): {[stepName: string]: [number] | number} {
        this.recordPreviousStepAndConfigureNewStep("AfterLastStep");

        return Object.assign({}, { steps: this._stepsList, all: calculateElapsedTime(this._allStartTime) }, this._eventsExecutionTimesInMilliseconds);
    }

    public subscribeTo(eventEmitter: EventEmitter): void {
        subscribeIncludingNestedEmitters(eventEmitter, stepStartedEventName, (args: StepStartedEventArguments) => {
            this.recordPreviousStepAndConfigureNewStep(args.stepName);
        });

        subscribeIncludingNestedEmitters(eventEmitter, milestoneReachedEventName, (args: MilestoneReachedEventArguments) => {
            this.recordTotalTimeUntilMilestone(args.milestoneName);
        });
    }
}
