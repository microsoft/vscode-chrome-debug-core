import { IResourceIdentifier } from './resourceIdentifier';

const CDTPScriptUrlSymbol = Symbol();
export type CDTPScriptUrl = string & { readonly [CDTPScriptUrlSymbol]: true };

const ScriptDevelopmentLocationSymbol = Symbol();
export interface ScriptDevelopmentLocation extends IResourceIdentifier {
    readonly [ScriptDevelopmentLocationSymbol]: true;
}

const SourceOfCompiledLocationSymbol = Symbol();
export interface SourceOfCompiledLocation extends IResourceIdentifier {
    readonly [SourceOfCompiledLocationSymbol]: true;
}
