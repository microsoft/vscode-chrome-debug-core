import * as utils from '../utils';
import { CrdpScript } from './chromeDebugAdapter';
import { Protocol as Crdp } from 'devtools-protocol';

export namespace Scripts {

    export let _scriptsById = new Map<Crdp.Runtime.ScriptId, CrdpScript>();
    export let _scriptsByUrl = new Map<string, CrdpScript>();

    export function getScriptByUrl(url: string) {
        const canonUrl = utils.canonicalizeUrl(url);
        return _scriptsByUrl.get(canonUrl) || _scriptsByUrl.get(utils.fixDriveLetter(canonUrl));
    }

    export function reset() {
        _scriptsById = new Map<Crdp.Runtime.ScriptId, Crdp.Debugger.ScriptParsedEvent>();
        _scriptsByUrl = new Map<string, Crdp.Debugger.ScriptParsedEvent>();
    }
}