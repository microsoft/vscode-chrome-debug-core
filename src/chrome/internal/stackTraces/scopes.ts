/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { LocationInScript } from '../locations/location';
import { Protocol as CDTP } from 'devtools-protocol';
import { CDTPNonPrimitiveRemoteObject } from '../../cdtpDebuggee/cdtpPrimitives';

/** This class represents a variable's scope (Globals, locals, block variables, etc...) */
export class Scope {
    constructor(
        public readonly type: ('global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module'),
        public readonly object: CDTPNonPrimitiveRemoteObject,
        public readonly name?: string,
        public readonly startLocation?: LocationInScript,
        public readonly endLocation?: LocationInScript) { }
}
