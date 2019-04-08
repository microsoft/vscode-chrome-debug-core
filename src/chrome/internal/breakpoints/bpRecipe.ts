/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ISource } from '../sources/source';
import { Location, ScriptOrSourceOrURLOrURLRegexp } from '../locations/location';
import { ILoadedSource } from '../sources/loadedSource';
import { IScript } from '../scripts/script';
import { IBPActionWhenHit, AlwaysPause, ConditionalPause, PauseOnHitCount } from './bpActionWhenHit';
import { IResourceIdentifier } from '../sources/resourceIdentifier';
import { URLRegexp } from '../locations/subtypes';
import { IEquivalenceComparable } from '../../utils/equivalence';
import { BPRecipeInLoadedSource, BPRecipeInScript, BPRecipeInUrl, BPRecipeInUrlRegexp } from './baseMappedBPRecipe';
import { BPRecipeInSource } from './bpRecipeInSource';

/**
 * IBPRecipe represents the instruction/recipe to set a breakpoint with some particular properties. Assuming that IBPRecipe ends up creating an actual
 * breakpoint in the debuggee, an instance of Breakpoint will be created to represent that actual breakpoint.
 */
export interface IBPRecipe<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit>
    extends IEquivalenceComparable {
    readonly location: Location<TResource>;
    readonly bpActionWhenHit: TBPActionWhenHit;

    isHitCountBreakpointRecipe(): this is IBPRecipe<TResource, PauseOnHitCount>;
}

export abstract class BaseBPRecipe<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit> implements IBPRecipe<TResource, TBPActionWhenHit> {
    public abstract get bpActionWhenHit(): TBPActionWhenHit;
    public abstract get location(): Location<TResource>;
    public abstract isEquivalentTo(right: this): boolean;

    public isHitCountBreakpointRecipe(): this is BPRecipe<TResource, PauseOnHitCount> {
        return this.bpActionWhenHit instanceof PauseOnHitCount;
    }

    public toString(): string {
        return `BP @ ${this.location} do: ${this.bpActionWhenHit}`;
    }
}

export type BPRecipe<TResource extends ScriptOrSourceOrURLOrURLRegexp, TBPActionWhenHit extends IBPActionWhenHit = IBPActionWhenHit>
    = IBPRecipe<TResource, TBPActionWhenHit> & (
        TResource extends ISource ? BPRecipeInSource<TBPActionWhenHit> :
        TResource extends ILoadedSource ? BPRecipeInLoadedSource<TBPActionWhenHit> :
        TBPActionWhenHit extends (AlwaysPause | ConditionalPause) ? (TResource extends IScript ? BPRecipeInScript :
            TResource extends IResourceIdentifier ? BPRecipeInUrl :
            TResource extends URLRegexp ? BPRecipeInUrlRegexp :
            never)
        : never
    );

export type BPInScriptSupportedHitActions = AlwaysPause | ConditionalPause;
