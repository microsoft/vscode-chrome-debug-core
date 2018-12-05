import { CDTPDiagnosticsModule, CDTPEventsEmitterDiagnosticsModule } from './cdtpDiagnosticsModule';
import { Crdp } from '../..';
import { CDTPStackTraceParser } from './cdtpStackTraceParser';
import { injectable } from 'inversify';
import { LogEntry } from './events';

export class CDTPConsole extends CDTPEventsEmitterDiagnosticsModule<Crdp.ConsoleApi> {
    public readonly onMessageAdded = this.addApiListener('messageAdded', (params: Crdp.Console.MessageAddedEvent) => params);

    public enable(): Promise<void> {
        return this.api.enable();

    }
    constructor(protected api: Crdp.ConsoleApi) {
        super();
    }
}

export class CDTPSchema extends CDTPDiagnosticsModule<Crdp.SchemaApi> {
    public async getDomains(): Promise<Crdp.Schema.Domain[]> {
        return (await this.api.getDomains()).domains;
    }

    constructor(protected api: Crdp.SchemaApi) {
        super();
    }
}

export interface IDOMInstrumentationBreakpoints {
    setInstrumentationBreakpoint(params: Crdp.DOMDebugger.SetInstrumentationBreakpointRequest): Promise<void>;
    removeInstrumentationBreakpoint(params: Crdp.DOMDebugger.SetInstrumentationBreakpointRequest): Promise<void>;
}

@injectable()
export class CDTPDOMDebugger extends CDTPDiagnosticsModule<Crdp.DOMDebuggerApi> implements IDOMInstrumentationBreakpoints {
    public setInstrumentationBreakpoint(params: Crdp.DOMDebugger.SetInstrumentationBreakpointRequest): Promise<void> {
        return this.api.setInstrumentationBreakpoint(params);
    }

    public removeInstrumentationBreakpoint(params: Crdp.DOMDebugger.SetInstrumentationBreakpointRequest): Promise<void> {
        return this.api.removeInstrumentationBreakpoint(params);
    }

    constructor(protected api: Crdp.DOMDebuggerApi) {
        super();
    }
}

export class CDTPPage extends CDTPEventsEmitterDiagnosticsModule<Crdp.PageApi> {
    public readonly onMessageAdded = this.addApiListener('frameNavigated', (params: Crdp.Page.FrameNavigatedEvent) => params);

    public enable(): Promise<void> {
        return this.api.enable();
    }

    public navigate(params: Crdp.Page.NavigateRequest): Promise<Crdp.Page.NavigateResponse> {
        return this.api.navigate(params);
    }

    public reload(params: Crdp.Page.ReloadRequest): Promise<void> {
        return this.api.reload(params);
    }

    constructor(protected api: Crdp.PageApi) {
        super();
    }
}

export class CDTPNetwork extends CDTPDiagnosticsModule<Crdp.NetworkApi> {
    public disable(): Promise<void> {
        return this.api.disable();
    }

    public enable(params: Crdp.Network.EnableRequest): Promise<void> {
        return this.api.enable(params);
    }

    public setCacheDisabled(params: Crdp.Network.SetCacheDisabledRequest): Promise<void> {
        return this.api.setCacheDisabled(params);
    }

    constructor(protected api: Crdp.NetworkApi) {
        super();
    }
}

export class CDTPBrowser extends CDTPDiagnosticsModule<Crdp.BrowserApi> {
    public getVersion(): Promise<Crdp.Browser.GetVersionResponse> {
        return this.api.getVersion();
    }

    constructor(protected api: Crdp.BrowserApi) {
        super();
    }
}

export class CDTPOverlay extends CDTPDiagnosticsModule<Crdp.OverlayApi> {
    public setPausedInDebuggerMessage(params: Crdp.Overlay.SetPausedInDebuggerMessageRequest): Promise<void> {
        return this.api.setPausedInDebuggerMessage(params);
    }

    constructor(protected api: Crdp.OverlayApi) {
        super();
    }
}

export class CDTPLog extends CDTPEventsEmitterDiagnosticsModule<Crdp.LogApi> {
    public readonly onEntryAdded = this.addApiListener('entryAdded', async (params: Crdp.Log.EntryAddedEvent) => await this.toLogEntry(params.entry));

    public enable(): Promise<void> {
        return this.api.enable();
    }

    private async toLogEntry(entry: Crdp.Log.LogEntry): Promise<LogEntry> {
        return {
            source: entry.source,
            level: entry.level,
            text: entry.text,
            timestamp: entry.timestamp,
            url: entry.url,
            lineNumber: entry.lineNumber,
            stackTrace: entry.stackTrace && await this._crdpToInternal.toStackTraceCodeFlow(entry.stackTrace),
            networkRequestId: entry.networkRequestId,
            workerId: entry.workerId,
            args: entry.args,
        };
    }

    constructor(protected readonly api: Crdp.LogApi, private readonly _crdpToInternal: CDTPStackTraceParser) {
        super();
    }
}
