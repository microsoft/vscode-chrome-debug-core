/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { IScript } from '../scripts/script';

/** We use these classes to generate a proper description for the function
 * based on wheter it is named, and the script where it's at is named
 */
const ImplementsCallFrameFunction = Symbol();
export interface ICallFrameFunction {
    readonly description: string;
    [ImplementsCallFrameFunction]: void;
}

class CallFrameForNamedFunction implements ICallFrameFunction {
    [ImplementsCallFrameFunction]: void;

    constructor(public readonly description: string) { }
}

class CallFrameForUnamedFunctionInUnnamedScript implements ICallFrameFunction {
    [ImplementsCallFrameFunction]: void;

    public readonly description = '(eval code)';
}

class CallFrameForUnamedFunctionInNamedScript implements ICallFrameFunction {
    [ImplementsCallFrameFunction]: void;

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
