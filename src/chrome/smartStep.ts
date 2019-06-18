import { DebugProtocol } from 'vscode-debugprotocol';
import { BasePathTransformer } from '../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../transformers/baseSourceMapTransformer';

export class SmartStepper {

    constructor(private _enabled: boolean) {}

    public async shouldSmartStep(stackFrame: DebugProtocol.StackFrame, pathTransformer: BasePathTransformer, sourceMapTransformer: BaseSourceMapTransformer): Promise<boolean> {
        if (!this._enabled) return false;

        const clientPath = pathTransformer.getClientPathFromTargetPath(stackFrame.source.path) || stackFrame.source.path;
        const mapping = await sourceMapTransformer.mapToAuthored(clientPath, stackFrame.line, stackFrame.column);
        if (mapping) {
            return false;
        }

        if ((await sourceMapTransformer.allSources(clientPath)).length) {
            return true;
        }

        return false;
    }
}