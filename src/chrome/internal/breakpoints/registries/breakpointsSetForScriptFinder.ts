/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as _ from 'lodash';
import { ValidatedMultiMap } from '../../../collections/validatedMultiMap';
import { LocationInScript } from '../../locations/location';
import { IScript } from '../../scripts/script';
import { injectable } from 'inversify';
import { BPRecipeInSourceWasResolved } from '../../../cdtpDebuggee/features/cdtpDebuggeeBreakpointsSetter';
import { BreakpointInSource } from '../breakpoint';

/**
 * Find the list of breakpoints that we set for a particular script
 */
@injectable()
export class BreakpointsSetForScriptFinder {
    private readonly _scriptToBreakpointResolved = ValidatedMultiMap.empty<IScript, BPRecipeInSourceWasResolved>();

    public bpRecipeIsResolved(bpRecipeWasResolved: BPRecipeInSourceWasResolved): void {
        this._scriptToBreakpointResolved.add(bpRecipeWasResolved.actualLocationInScript.script, bpRecipeWasResolved);
    }

    public tryGettingBreakpointAtLocation(locationInScript: LocationInScript): BreakpointInSource[] {
        const breakpointsResolved = _.defaultTo(this._scriptToBreakpointResolved.tryGetting(locationInScript.script), new Set());
        const bpsAtLocation = [];
        for (const bpResolved of breakpointsResolved) {
            if (bpResolved.actualLocationInScript.isSameAs(locationInScript)) {
                bpsAtLocation.push(bpResolved.breakpoint);
            }
        }

        return bpsAtLocation;
    }

    public toString(): string {
        return `Breakpoints recipe status Registry:\nRecipe to breakpoints: ${this._scriptToBreakpointResolved}`;
    }
}
