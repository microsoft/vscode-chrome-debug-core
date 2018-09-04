import { IScript } from '../scripts/script';

export interface ICallFrameName {
    readonly name: string;
}

export class NamedFunctionCallFrameName implements ICallFrameName {
    constructor(public readonly name: string) { }
}

export class UnamedFunctionInEvalScriptCallFrameName implements ICallFrameName {
    public readonly name = '(eval code)';
}

export class UnamedFunctionInFileCallFrameName implements ICallFrameName {
    public readonly name = '(anonymous function)';
}

export class FormattedName implements ICallFrameName {
    constructor(public readonly name: string) { }
}

export function createCallFrameName(script: IScript, functionName: string) {
    if (functionName) {
        return new NamedFunctionCallFrameName(functionName);
    } else if (script.runtimeSource.doesScriptHasUrl()) {
        return new UnamedFunctionInFileCallFrameName();
    } else {
        return new UnamedFunctionInEvalScriptCallFrameName();
    }
}
