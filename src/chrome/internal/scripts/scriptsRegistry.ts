import { Crdp } from '../../..';
import { IScript } from './script';
import { ValidatedMap } from '../../collections/validatedMap';
import { IResourceIdentifier, newResourceIdentifierMap } from '../sources/resourceIdentifier';
import { ExecutionContext, IExecutionContext } from './executionContext';
import { injectable } from 'inversify';

@injectable()
export class DeleteMeScriptsRegistry {
    private readonly _scriptsGeneration = new ScriptsGeneration();
    private readonly _idToExecutionContext = new ValidatedMap<Crdp.Runtime.ExecutionContextId, ExecutionContext>();

    public registerExecutionContext(executionContextId: Crdp.Runtime.ExecutionContextId): IExecutionContext {
        const executionContext = new ExecutionContext();
        this._idToExecutionContext.set(executionContextId, executionContext);
        return executionContext;
    }

    public getExecutionContextById(executionContextId: Crdp.Runtime.ExecutionContextId): IExecutionContext {
        return this._idToExecutionContext.get(executionContextId);
    }

    public registerNewScript(scriptId: Crdp.Runtime.ScriptId, obtainScript: () => Promise<IScript>): Promise<IScript> {
        return this._scriptsGeneration.registerNewScript(scriptId, obtainScript);
    }

    public getCrdpId(script: IScript): any {
        return this._scriptsGeneration.getCdtpId(script);
    }

    public getScriptById(runtimeScriptCrdpId: Crdp.Runtime.ScriptId): Promise<IScript> {
        return this._scriptsGeneration.scriptById(runtimeScriptCrdpId);
    }

    public getScriptsByPath(nameOrLocation: IResourceIdentifier): IScript[] {
        return this._scriptsGeneration.getScriptByPath(nameOrLocation);
    }

    public getAllScripts(): Promise<IScript[]> {
        return this._scriptsGeneration.getAllScripts();
    }
}

export class ScriptsGeneration {
    private readonly _cdtpIdByScript = new ValidatedMap<Crdp.Runtime.ScriptId, Promise<IScript>>();
    private readonly _scriptByCdtpId = new ValidatedMap<IScript, Crdp.Runtime.ScriptId>();
    private readonly _scriptByPath = newResourceIdentifierMap<IScript[]>();

    private createScriptInitialConfiguration(scriptId: Crdp.Runtime.ScriptId, script: IScript): void {
        this._scriptByCdtpId.set(script, scriptId);

        let scriptsWithSamePath = this._scriptByPath.getOrAdd(script.runtimeSource.identifier, () => []);
        scriptsWithSamePath.push(script);
    }

    public async registerNewScript(scriptId: Crdp.Runtime.ScriptId, obtainScript: () => Promise<IScript>): Promise<IScript> {
        const scriptWithConfigurationPromise = obtainScript().then(script => {
            /**
             * We need to configure the script here, so we can guarantee that clients who try to use a script will get
             * blocked until the script is created, and all the initial configuration is done, so they can use APIs to get
             * the script id, search by URL, etc...
             */
            this.createScriptInitialConfiguration(scriptId, script);
            return script;
        });

        this._cdtpIdByScript.set(scriptId, scriptWithConfigurationPromise);

        return await scriptWithConfigurationPromise;
    }

    public getCdtpId(script: IScript): Crdp.Runtime.ScriptId {
        const scriptId = this._scriptByCdtpId.get(script);

        if (script === undefined) {
            throw new Error(`Couldn't find a CRDP id for script ${script}`);
        }

        return scriptId;
    }

    public scriptById(runtimeScriptCrdpId: string): Promise<IScript> {
        return this._cdtpIdByScript.get(runtimeScriptCrdpId);
    }

    public getScriptByPath(path: IResourceIdentifier): IScript[] {
        const runtimeScript = this._scriptByPath.tryGetting(path);
        return runtimeScript || [];
    }

    public getAllScripts(): Promise<IScript[]> {
        return Promise.all(Array.from(this._cdtpIdByScript.values()));
    }
}
