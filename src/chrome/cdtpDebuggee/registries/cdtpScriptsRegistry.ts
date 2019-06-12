/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { Protocol as CDTP } from 'devtools-protocol';
import { IScript } from '../../internal/scripts/script';
import { ValidatedMap } from '../../collections/validatedMap';
import { ExecutionContext, IExecutionContext } from '../../internal/scripts/executionContext';
import { injectable } from 'inversify';
import { IResourceIdentifier, newResourceIdentifierMap } from '../../internal/sources/resourceIdentifier';
import { FrameId } from '../cdtpPrimitives';
import * as _ from 'lodash';
import { DoNotLog } from '../../logging/decorators';
import { printMap } from '../../collections/printing';

/**
 * TODO: The CDTPScriptsRegistry is still a work in progress. We need to understand exactly how the ExecutionContexts, the Scripts, and the script "generations" work to figure out the best way to implement this
 * Is ExecutionContext == Generation? Or is a Generation a set of ExecutionContexts?
 */

@injectable()
export class CDTPScriptsRegistry {
    private readonly _idToExecutionContext = new ValidatedMap<CDTP.Runtime.ExecutionContextId, ExecutionContext>();
    private readonly _scripts = new CDTPCurrentGeneration();

    public registerExecutionContext(executionContextId: CDTP.Runtime.ExecutionContextId, frameId: FrameId): IExecutionContext {
        const executionContext = new ExecutionContext(frameId);
        this._idToExecutionContext.set(executionContextId, executionContext);
        return executionContext;
    }

    public markExecutionContextAsDestroyed(executionContextId: CDTP.Runtime.ExecutionContextId): IExecutionContext {
        const executionContext = this._idToExecutionContext.get(executionContextId);
        executionContext.markAsDestroyed();
        return executionContext;
    }

    public getExecutionContextById(executionContextId: CDTP.Runtime.ExecutionContextId): IExecutionContext {
        return this._idToExecutionContext.get(executionContextId);
    }

    public registerScript(scriptId: CDTP.Runtime.ScriptId, obtainScript: () => Promise<IScript>): Promise<IScript> {
        return this._scripts.registerNewScript(scriptId, obtainScript);
    }

    public getCdtpId(script: IScript): any {
        return this._scripts.getCdtpId(script);
    }

    @DoNotLog()
    public getScriptByCdtpId(runtimeScriptCrdpId: CDTP.Runtime.ScriptId): Promise<IScript> {
        return this._scripts.getScriptByCdtpId(runtimeScriptCrdpId);
    }

    public getAllScripts(): IterableIterator<Promise<IScript>> {
        return this._scripts.getAllScripts();
    }

    public getScriptsByPath(nameOrLocation: IResourceIdentifier): IScript[] {
        return this._scripts.getScriptByPath(nameOrLocation);
    }

    public toString(): string {
        return `${this._scripts}`;
    }
}

class CDTPCurrentGeneration {
    // We use these two maps instead of a bidirectional map because we need to map an ID to a Promise instead of a script, to avoid having race conditions...
    private readonly _cdtpIdByScript = new ValidatedMap<CDTP.Runtime.ScriptId, Promise<IScript>>();
    private readonly _scriptByCdtpId = new ValidatedMap<IScript, CDTP.Runtime.ScriptId>();
    private readonly _scriptByPath = newResourceIdentifierMap<IScript[]>();

    public async registerNewScript(scriptId: CDTP.Runtime.ScriptId, obtainScript: () => Promise<IScript>): Promise<IScript> {
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

    private createScriptInitialConfiguration(scriptId: CDTP.Runtime.ScriptId, script: IScript): void {
        this._scriptByCdtpId.set(script, scriptId);

        let scriptsWithSamePath = this._scriptByPath.getOrAdd(script.runtimeSource.identifier, () => []);
        scriptsWithSamePath.push(script);
    }

    public getCdtpId(script: IScript): CDTP.Runtime.ScriptId {
        return this._scriptByCdtpId.get(script);
    }

    public getScriptByCdtpId(runtimeScriptCrdpId: string): Promise<IScript> {
        return this._cdtpIdByScript.get(runtimeScriptCrdpId);
    }

    public getAllScripts(): IterableIterator<Promise<IScript>> {
        return this._cdtpIdByScript.values();
    }

    public getScriptByPath(path: IResourceIdentifier): IScript[] {
        const runtimeScript = this._scriptByPath.tryGetting(path);
        return _.defaultTo(runtimeScript, []);
    }

    public toString(): string {
        return printMap('Script to ID', this._scriptByCdtpId);
    }
}
