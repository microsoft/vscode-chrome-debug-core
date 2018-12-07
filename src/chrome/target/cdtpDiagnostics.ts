import { Crdp } from '../..';
import { CDTPStackTraceParser } from './cdtpStackTraceParser';
import { CDTPDebugger } from './cdtpDebugger';
import { CDTPConsole, CDTPSchema, CDTPDOMDebugger, CDTPPage, CDTPNetwork, CDTPBrowser, CDTPOverlay, CDTPLog } from './cdtpSmallerModules';
import { CDTPRuntime } from './cdtpRuntime';
import { BreakpointIdRegistry } from './breakpointIdRegistry';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';
import { injectable, inject } from 'inversify';
import { IComponent } from '../internal/features/feature';
import { CDTPDebuggerEventsProvider } from './cdtpDebuggerEventsProvider';
import { CDTPLocationParser } from './cdtpLocationParser';
import { ExceptionThrownEventProvider } from './exceptionThrownEventProvider';
import { TYPES } from '../dependencyInjection.ts/types';

// TODO: Remove this class and use dependency injection/inversify to initialize all this
@injectable()
export class CDTPDiagnostics implements IComponent {
    public Debugger: CDTPDebugger;
    public DebuggerEvents: CDTPDebuggerEventsProvider;
    public ExceptionThrownEventProvider: ExceptionThrownEventProvider;
    public Console: CDTPConsole;
    public Runtime: CDTPRuntime;
    public Schema: CDTPSchema;
    public DOMDebugger: CDTPDOMDebugger;
    public Page: CDTPPage;
    public Network: CDTPNetwork;
    public Browser: CDTPBrowser;
    public Overlay: CDTPOverlay;
    public Log: CDTPLog;

    public async install(): Promise<void> {
        // Enable domains so we can use the handlers
        await Promise.all([
            this.Debugger.enable(),
            this.Runtime.enable().then(() => this.Runtime.runIfWaitingForDebugger()),
            this.Log.enable().catch(_exception => { }) // Not supported by all runtimes
        ]);
    }

    constructor(@inject(TYPES.CDTPClient) private _api: Crdp.ProtocolApi) {
        const scriptsRegistry = new CDTPScriptsRegistry();
        const breakpointIdRegistry = new BreakpointIdRegistry();
        const cdtpLocationParser = new CDTPLocationParser(scriptsRegistry);
        const cdtpStackTraceParser = new CDTPStackTraceParser(cdtpLocationParser);
        this.Debugger = new CDTPDebugger(this._api, scriptsRegistry);
        this.DebuggerEvents = new CDTPDebuggerEventsProvider(this._api.Debugger, cdtpStackTraceParser, breakpointIdRegistry, cdtpLocationParser);
        this.ExceptionThrownEventProvider = new ExceptionThrownEventProvider(this._api, cdtpStackTraceParser, scriptsRegistry);
        this.Console = new CDTPConsole(this._api.Console);
        this.Runtime = new CDTPRuntime(this._api.Runtime, cdtpStackTraceParser);
        this.Schema = new CDTPSchema(this._api.Schema);
        this.DOMDebugger = new CDTPDOMDebugger(this._api.DOMDebugger);
        this.Page = new CDTPPage(this._api.Page);
        this.Network = new CDTPNetwork(this._api.Network);
        this.Browser = new CDTPBrowser(this._api.Browser);
        this.Overlay = new CDTPOverlay(this._api.Overlay);
        this.Log = new CDTPLog(this._api.Log, cdtpStackTraceParser);
    }
}
