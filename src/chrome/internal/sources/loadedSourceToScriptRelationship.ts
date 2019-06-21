import { IScript } from '../scripts/script';
import { UnmappedSourceMapper } from '../scripts/sourcesMapper';
import { ILoadedSource, ScriptAndSourceMapper } from './loadedSource';

export interface ILoadedSourceToScriptRelationship {
    readonly scriptAndSourceMapper: ScriptAndSourceMapper;
    readonly script: IScript;
}

abstract class BaseLoadedSourceToScriptRelationship implements ILoadedSourceToScriptRelationship {
    abstract get scriptAndSourceMapper(): ScriptAndSourceMapper;
    abstract get script(): IScript;
}

/// Script was created from this source and it doesn't need a source-map to be mapped
export class UnmappedSourceOf extends BaseLoadedSourceToScriptRelationship {
    constructor(public readonly runtimeSource: ILoadedSource, public readonly script: IScript) {
        super();
    }

    public get scriptAndSourceMapper(): ScriptAndSourceMapper {
        return new ScriptAndSourceMapper(this.script, new UnmappedSourceMapper(this.script, this.runtimeSource));
    }

    public toString(): string {
        return `${this.runtimeSource} is runtime source of ${this.script}`;
    }
}

/// A sourcemap indicated that this mapped source was used to generate the DevelopmentSource
export class MappedSourceOf extends BaseLoadedSourceToScriptRelationship {
    constructor(public readonly mappedSource: ILoadedSource, public readonly script: IScript) {
        super();
    }

    public get scriptAndSourceMapper(): ScriptAndSourceMapper {
        return new ScriptAndSourceMapper(this.script, this.script.sourceMapper);
    }

    public toString(): string {
        return `${this.mappedSource} is a mapped source of ${this.script.developmentSource}/${this.script}`;
    }
}
