import { LocationInScript } from '../locations/location';
import { Protocol as CDTP } from 'devtools-protocol';

/** This class represents a variable's scope (Globals, locals, block variables, etc...) */
export class Scope {
    constructor(
        public readonly type: ('global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module'),
        public readonly object: CDTP.Runtime.RemoteObject,
        public readonly name?: string,
        public readonly startLocation?: LocationInScript,
        public readonly endLocation?: LocationInScript) { }
}
