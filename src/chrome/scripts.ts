import * as utils from '../utils';
import { CrdpScript } from './chromeDebugAdapter';
import { Protocol as Crdp } from 'devtools-protocol';
import * as ChromeUtils from './chromeUtils';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ChromeDebugAdapter } from './chromeDebugAdapter';
import { BasePathTransformer, BaseSourceMapTransformer } from '..';
import * as path from 'path';

/**
 * Represents a reference to a source/script. `contents` is set if there are inlined sources.
 * Otherwise, scriptId can be used to retrieve the contents from the runtime.
 */
export interface ISourceContainer {
    /** The runtime-side scriptId of this script */
    scriptId?: Crdp.Runtime.ScriptId;
    /** The contents of this script, if they are inlined in the sourcemap */
    contents?: string;
    /** The authored path to this script (only set if the contents are inlined) */
    mappedPath?: string;
}

export class ScriptContainer {

    private _scriptsById = new Map<Crdp.Runtime.ScriptId, CrdpScript>();
    private _scriptsByUrl = new Map<string, CrdpScript>();
    private _sourceHandles = new utils.ReverseHandles<ISourceContainer>();

    /**
     * @deprecated use the function calls instead
     */
    public get scriptsByIdMap() { return this._scriptsById; }

    /**
     * Get a list of all currently loaded scripts
     */
    public get loadedScripts() { return this._scriptsById.values(); }

    /**
     * Get a script by its url
     * @param url
     */
    public getScriptByUrl(url: string) {
        const canonUrl = utils.canonicalizeUrl(url);
        return this._scriptsByUrl.get(canonUrl) || this._scriptsByUrl.get(utils.fixDriveLetter(canonUrl));
    }

    /**
     * Clear this container of all loaded scripts
     */
    public reset() {
        this._scriptsById = new Map<Crdp.Runtime.ScriptId, Crdp.Debugger.ScriptParsedEvent>();
        this._scriptsByUrl = new Map<string, Crdp.Debugger.ScriptParsedEvent>();
    }

    /**
     * Add a newly parsed script to this container
     * @param script The scriptParsed event
     */
    public add(script: Crdp.Debugger.ScriptParsedEvent) {
        this._scriptsById.set(script.scriptId, script);
        this._scriptsByUrl.set(utils.canonicalizeUrl(script.url), script);
    }

    /**
     * Get a script by its CDP identifier
     * @param id
     */
    public getScriptById(id: string) {
        return this._scriptsById.get(id);
    }


    /**
     * Get a list of all loaded script urls (as a string)
     */
    public getAllScriptsString(pathTransformer: BasePathTransformer, sourceMapTransformer: BaseSourceMapTransformer): Promise<string> {
        const runtimeScripts = Array.from(this._scriptsByUrl.keys())
            .sort();
        return Promise.all(runtimeScripts.map(script => this.getOneScriptString(script, pathTransformer, sourceMapTransformer))).then(strs => {
            return strs.join('\n');
        });
    }

    /**
     * Get a script string?
     * @param runtimeScriptPath
     */
    public getOneScriptString(runtimeScriptPath: string, pathTransformer: BasePathTransformer, sourceMapTransformer: BaseSourceMapTransformer): Promise<string> {
        let result = '› ' + runtimeScriptPath;
        const clientPath = pathTransformer.getClientPathFromTargetPath(runtimeScriptPath);
        if (clientPath && clientPath !== runtimeScriptPath) result += ` (${clientPath})`;

        return sourceMapTransformer.allSourcePathDetails(clientPath || runtimeScriptPath).then(sourcePathDetails => {
            let mappedSourcesStr = sourcePathDetails.map(details => `    - ${details.originalPath} (${details.inferredPath})`).join('\n');
            if (sourcePathDetails.length) mappedSourcesStr = '\n' + mappedSourcesStr;

            return result + mappedSourcesStr;
        });
    }

     /**
     * Get the existing handle for this script, identified by runtime scriptId, or create a new one
     */
    public getSourceReferenceForScriptId(scriptId: Crdp.Runtime.ScriptId): number {
        return this._sourceHandles.lookupF(container => container.scriptId === scriptId) ||
            this._sourceHandles.create({ scriptId });
    }

    /**
     * Get the existing handle for this script, identified by runtime scriptId, or create a new one
     */
    public getSourceReferenceForScriptPath(mappedPath: string, contents: string): number {
        return this._sourceHandles.lookupF(container => container.mappedPath === mappedPath) ||
            this._sourceHandles.create({ contents, mappedPath });
    }

    /**
     * Map a chrome script to a DAP source
     * @param script
     * @param origin
     */
    public async scriptToSource(script: Crdp.Debugger.ScriptParsedEvent, origin: string): Promise<DebugProtocol.Source> {
        const sourceReference = this.getSourceReferenceForScriptId(script.scriptId);


        const properlyCasedScriptUrl = utils.canonicalizeUrl(script.url);
        const displayPath = Scripts.realPathToDisplayPath(properlyCasedScriptUrl);

        const exists = await utils.existsAsync(properlyCasedScriptUrl); // script.url can start with file:/// so we use the canonicalized version
        return <DebugProtocol.Source>{
            name: path.basename(displayPath),
            path: displayPath,
            // if the path exists, do not send the sourceReference
            sourceReference: exists ? undefined : sourceReference,
            origin
        };
    }

    /**
     * Get a source handle by it's reference number
     * @param ref
     */
    public getSource(ref: number) {
        return this._sourceHandles.get(ref);
    }

    public fakeUrlForSourceReference(sourceReference: number): string {
        const handle = this._sourceHandles.get(sourceReference);
        return `${ChromeUtils.EVAL_NAME_PREFIX}${handle.scriptId}`;
    }

    public displayNameForSourceReference(sourceReference: number): string {
        const handle = this._sourceHandles.get(sourceReference);
        return (handle && this.displayNameForScriptId(handle.scriptId)) || sourceReference + '';
    }

    public displayNameForScriptId(scriptId: number|string): string {
        return `${ChromeUtils.EVAL_NAME_PREFIX}${scriptId}`;
    }
}

export namespace Scripts {
    /**
     * Called when returning a stack trace, for the path for Sources that have a sourceReference, so consumers can
     * tweak it, since it's only for display.
     */
    export function realPathToDisplayPath(realPath: string): string {
        if (ChromeUtils.isEvalScript(realPath)) {
            return `${ChromeDebugAdapter.EVAL_ROOT}/${realPath}`;
        }

        return realPath;
    }

    export function displayPathToRealPath(displayPath: string): string {
        if (displayPath.startsWith(ChromeDebugAdapter.EVAL_ROOT)) {
            return displayPath.substr(ChromeDebugAdapter.EVAL_ROOT.length + 1); // Trim "<eval>/"
        }

        return displayPath;
    }
}
