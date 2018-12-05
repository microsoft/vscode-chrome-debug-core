import { Crdp } from '../..';
import { IScript } from '../internal/scripts/script';
import { TargetToInternal } from './targetToInternal';
import { InternalToTarget } from './internalToTarget';
import { CDTPDebugger } from './cdtpDebugger';
import { ValidatedMap } from '../collections/validatedMap';
import { CDTPConsole, CDTPSchema, CDTPDOMDebugger, CDTPPage, CDTPNetwork, CDTPBrowser, CDTPOverlay, CDTPLog } from './cdtpSmallerModules';
import { CDTPRuntime } from './cdtpRuntime';
import { BreakpointIdRegistry } from './breakpointIdRegistry';
import { ICallFrame } from '../internal/stackTraces/callFrame';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';
import { injectable } from 'inversify';
import { IComponent } from '../internal/features/feature';

@injectable()
export class CDTPDiagnostics implements IComponent {
    public Debugger: CDTPDebugger;
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

    constructor(private _api: Crdp.ProtocolApi) {
        const scriptsRegistry = new CDTPScriptsRegistry();
        const breakpointIdRegistry = new BreakpointIdRegistry();
        const crdpToInternal = new TargetToInternal(scriptsRegistry, breakpointIdRegistry);
        const internalToCRDP = new InternalToTarget(new ValidatedMap<ICallFrame<IScript>, Crdp.Debugger.CallFrameId>());
        this.Debugger = new CDTPDebugger(this._api.Debugger, crdpToInternal, internalToCRDP, scriptsRegistry);
        this.Console = new CDTPConsole(this._api.Console);
        this.Runtime = new CDTPRuntime(this._api.Runtime, crdpToInternal, internalToCRDP, scriptsRegistry);
        this.Schema = new CDTPSchema(this._api.Schema);
        this.DOMDebugger = new CDTPDOMDebugger(this._api.DOMDebugger);
        this.Page = new CDTPPage(this._api.Page);
        this.Network = new CDTPNetwork(this._api.Network);
        this.Browser = new CDTPBrowser(this._api.Browser);
        this.Overlay = new CDTPOverlay(this._api.Overlay);
        this.Log = new CDTPLog(this._api.Log, crdpToInternal);
    }
}
