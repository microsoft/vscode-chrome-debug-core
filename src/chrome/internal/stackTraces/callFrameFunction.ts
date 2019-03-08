import { IScript } from '../scripts/script';

/** We use these classes to generate a proper description for the function
 * based on wheter it is named, and the script where it's at is named
 */
const ImplementsCallFrameFunction = Symbol();
export interface ICallFrameFunction {
    readonly description: string;
    [ImplementsCallFrameFunction]: string;
}

class CallFrameForNamedFunction implements ICallFrameFunction {
    [ImplementsCallFrameFunction]: 'ICallFrameFunction';

    constructor(public readonly description: string) { }
}

class CallFrameForUnamedFunctionInUnnamedScript implements ICallFrameFunction {
    [ImplementsCallFrameFunction]: 'ICallFrameFunction';

    public readonly description = '(eval code)';
}

class CallFrameForUnamedFunctionInNamedScript implements ICallFrameFunction {
    [ImplementsCallFrameFunction]: 'ICallFrameFunction';

    public readonly description = '(anonymous function)';
}

export function createCallFrameFunction(script: IScript, functionName: string) {
    if (functionName) {
        return new CallFrameForNamedFunction(functionName);
    } else if (script.runtimeSource.doesScriptHasUrl()) {
        return new CallFrameForUnamedFunctionInNamedScript();
    } else {
        return new CallFrameForUnamedFunctionInUnnamedScript();
    }
}
