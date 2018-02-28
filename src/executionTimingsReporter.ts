import { HighResTimer, calculateElapsedTime } from "./utils";

export type TimingsReport = {[stepName: string]: [number] | number};

export interface ProgressReporter {
    startStep(stepName: string): void;
    startRepeatableStep(stepName: string): void;
    generateReport(): TimingsReport;
    isNull(): boolean;
}

/* Use to track the time executing each step during launch
    Usage:
        reporter.startStep("Attach");
        reporter.startStep("Attach.AttachToTargetDebuggerWebsocket");
        reporter.startStep("ClientRequest.setBreakpoints");
        reporter.startStep("WaitingAfter.ClientRequest.setBreakpoints");
        reporter.startStep("ClientRequest.setBreakpoints");
        reporter.startStep("WaitingAfter.ClientRequest.setBreakpoints");
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

export class ExecutionTimingsReporter implements ProgressReporter {
    private readonly _allStartTime: HighResTimer;
    private readonly _repeatableStepsExecutionTimesInMilliseconds: {[stepName: string]: [number]} = {};
    private readonly _stepExecutionTimesInMilliseconds: {[stepName: string]: number} = {};
    private readonly _stepsList = [] as [string];

    private _currentStepStartTime: HighResTimer;
    private _currentStepName = "BeforeFirstStep";
    private _currentStepIsRepeatable = false;

    constructor() {
        this._currentStepStartTime = this._allStartTime = process.hrtime();
    }

    public startStep(stepName: string): void {
        if (this._stepExecutionTimesInMilliseconds[stepName] || this._repeatableStepsExecutionTimesInMilliseconds[stepName] || this._currentStepName === stepName) {
            throw new RangeError(`A step named ${stepName} was already reported.`);
        }

        this.recordPreviousStepAndConfigureNewStep(stepName, false);
    }

    public startRepeatableStep(stepName: string): void {
        this.recordPreviousStepAndConfigureNewStep(stepName, true);
    }

    private recordPreviousStepAndConfigureNewStep(newStepName: string, newStepIsRepeatable: boolean): void {
        this.recordPreviousStep();

        this._currentStepStartTime = process.hrtime();
        this._currentStepName = newStepName;
        this._currentStepIsRepeatable = newStepIsRepeatable;
    }

    private recordPreviousStep(): void {
        const previousStepTimeTakenInMilliseconds = calculateElapsedTime(this._currentStepStartTime);

        if (this._currentStepIsRepeatable) {
            const executionTimes = this._repeatableStepsExecutionTimesInMilliseconds[this._currentStepName] = this._repeatableStepsExecutionTimesInMilliseconds[this._currentStepName] || [] as [number];
            executionTimes.push(previousStepTimeTakenInMilliseconds);
        } else {
            this._stepExecutionTimesInMilliseconds[this._currentStepName] = previousStepTimeTakenInMilliseconds;
        }
        this._stepsList.push(this._currentStepName);
    }

    public generateReport(): {[stepName: string]: [number] | number} {
        this.recordPreviousStepAndConfigureNewStep("AfterLastStep", false);
        this._stepExecutionTimesInMilliseconds.All = calculateElapsedTime(this._allStartTime);

        return Object.assign({}, this._stepExecutionTimesInMilliseconds, this._repeatableStepsExecutionTimesInMilliseconds, {steps: this._stepsList});
    }

    public isNull(): boolean {
        return false;
    }
}

export class NullProgressReporter implements ProgressReporter {
    public startStep(stepName: string): void {}
    public startRepeatableStep(stepName: string): void {}
    public generateReport(): TimingsReport {
        throw new Error("A null progress reporter can't generate a report");
    }
    public isNull(): boolean {
        return true;
    }
}

export class ProgressReporterWrapper implements ProgressReporter {
    constructor(private _wrapped: ProgressReporter) {}
    public startStep(stepName: string): void {
        this._wrapped.startStep(stepName);
    }

    public startRepeatableStep(stepName: string): void {
        this._wrapped.startRepeatableStep(stepName);
    }

    public generateReport(): TimingsReport {
        return this._wrapped.generateReport();
    }

    public changeWrappedTo(newWrapped: ProgressReporter): void {
        this._wrapped = newWrapped;
    }

    public isNull(): boolean {
        return this._wrapped.isNull();
    }
}
