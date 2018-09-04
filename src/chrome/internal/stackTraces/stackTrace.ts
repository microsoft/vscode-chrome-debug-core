import { ScriptOrSource } from '../locations/location';
import { CodeFlowFrame } from './callFrame';

export class CodeFlowStackTrace<TResource extends ScriptOrSource> {
    constructor(
        public readonly codeFlowFrames: NonNullable<CodeFlowFrame<TResource>[]>,
        public readonly description?: NonNullable<string>,
        public readonly parent?: NonNullable<CodeFlowStackTrace<TResource>>) { }
}
