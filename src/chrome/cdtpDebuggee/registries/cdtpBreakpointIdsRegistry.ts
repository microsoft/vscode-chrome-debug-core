/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { BidirectionalMap } from '../../collections/bidirectionalMap';
import { Protocol as CDTP } from 'devtools-protocol';
import { injectable } from 'inversify';
import { CDTPBPRecipe } from '../cdtpPrimitives';

@injectable()
export class CDTPBreakpointIdsRegistry {
    // TODO DIEGO: Figure out how to handle if two breakpoint rules set a breakpoint in the same location so it ends up being the same breakpoint id
    private readonly _recipeToBreakpointId = new BidirectionalMap<CDTPBPRecipe, CDTP.Debugger.BreakpointId>();

    public registerRecipe(cdtpBreakpointId: CDTP.Debugger.BreakpointId, bpRecipe: CDTPBPRecipe): void {
        this._recipeToBreakpointId.set(bpRecipe, cdtpBreakpointId);
    }

    public unregisterRecipe(bpRecipe: CDTPBPRecipe): void {
        this._recipeToBreakpointId.deleteByLeft(bpRecipe);
    }

    public getBreakpointId(bpRecipe: CDTPBPRecipe): CDTP.Debugger.BreakpointId {
        return this._recipeToBreakpointId.getByLeft(bpRecipe);
    }

    public getRecipeByBreakpointId(cdtpBreakpointId: CDTP.Debugger.BreakpointId): CDTPBPRecipe {
        return this._recipeToBreakpointId.getByRight(cdtpBreakpointId);
    }

    public toString(): string {
        return `Breakpoint IDs: ${this._recipeToBreakpointId}`;
    }
}
