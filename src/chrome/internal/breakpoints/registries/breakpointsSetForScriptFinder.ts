/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ValidatedMultiMap } from '../../../collections/validatedMultiMap';
import { LocationInScript } from '../../locations/location';
import { CDTPBreakpoint } from '../../../cdtpDebuggee/cdtpPrimitives';
import { IScript } from '../../scripts/script';
import { IBreakpointsEventsListener, BreakpointsEventSystem } from '../features/breakpointsEventSystem';
import { injectable, inject, LazyServiceIdentifer } from 'inversify';
import { PrivateTypes } from '../diTypes';

/**
 * Find the list of breakpoints that we set for a particular script
 */
@injectable()
export class BreakpointsSetForScriptFinder {
    private readonly _scriptToBreakpoints = new ValidatedMultiMap<IScript, CDTPBreakpoint>();

    public constructor(@inject(PrivateTypes.IBreakpointsEventsListener) breakpointsEventsListener: IBreakpointsEventsListener) {
        breakpointsEventsListener.listenForOnBreakpointIsBound(breakpoint => this.onBreakpointIsBound(breakpoint));
    }

    private onBreakpointIsBound(breakpoint: CDTPBreakpoint): void {
        this._scriptToBreakpoints.add(breakpoint.actualLocation.script, breakpoint);
    }

    public tryGettingBreakpointAtLocation(locationInScript: LocationInScript): CDTPBreakpoint[] {
        const breakpoints = this._scriptToBreakpoints.tryGetting(locationInScript.script) || new Set();
        const bpsAtLocation = [];
        for (const bp of breakpoints) {
            if (bp.actualLocation.isSameAs(locationInScript)) {
                bpsAtLocation.push(bp);
            }
        }

        return bpsAtLocation;
    }

    public toString(): string {
        return `Breakpoints recipe status Registry:\nRecipe to breakpoints: ${this._scriptToBreakpoints}`;
    }
}
