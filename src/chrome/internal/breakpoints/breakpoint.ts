/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { LocationInScript, LocationInLoadedSource } from '../locations/location';
import { IScript } from '../scripts/script';
import { URLRegexp } from '../locations/subtypes';
import { IResourceIdentifier, IURL } from '../sources/resourceIdentifier';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { ISource } from '../sources/source';
import { IBPRecipeForRuntimeSource } from './baseMappedBPRecipe';
import { BPRecipeInSource } from './bpRecipeInSource';
import { IBPRecipe, BPInScriptSupportedHitActions } from './bpRecipe';

export type BPPossibleResources = IScript | ISource | URLRegexp | IResourceIdentifier<CDTPScriptUrl>;
export type ActualLocation<TResource extends BPPossibleResources> =
    TResource extends IScript ? LocationInScript :
    TResource extends URLRegexp ? LocationInScript :
    TResource extends IResourceIdentifier<CDTPScriptUrl> ? LocationInScript :
    TResource extends ISource ? LocationInLoadedSource :
    LocationInScript;

/// We use the breakpoint class when the debugger actually configures a file to stop (or do something) at a certain place under certain conditions
export interface IBreakpoint<TResource extends BPPossibleResources> {
    readonly recipe: IBPRecipe<TResource>;
    readonly actualLocation: ActualLocation<TResource>;
}

abstract class BaseBreakpoint<TResource extends BPPossibleResources> implements IBreakpoint<TResource> {
    public abstract get recipe(): IBPRecipe<TResource>;
    public abstract get actualLocation(): ActualLocation<TResource>;

    public toString(): string {
        return `${this.recipe} actual location is ${this.actualLocation}`;
    }
}

type MappableBPPossibleResources = IScript | IResourceIdentifier<CDTPScriptUrl> | URLRegexp;
export class MappableBreakpoint<TResource extends MappableBPPossibleResources> extends BaseBreakpoint<TResource> {
    public mappedToSource(): BreakpointInSource {
        return new BreakpointInSource(this.recipe.unmappedBPRecipe, this.actualLocation.mappedToSource());
    }

    constructor(public readonly recipe: IBPRecipeForRuntimeSource<TResource, BPInScriptSupportedHitActions>, public readonly actualLocation: ActualLocation<TResource>) {
        super();
    }
}

export class BreakpointInScript extends MappableBreakpoint<IScript> { }

export class BreakpointInUrl extends MappableBreakpoint<IURL<CDTPScriptUrl>> { }

export class BreakpointInSource extends BaseBreakpoint<ISource> {
    constructor(public readonly recipe: BPRecipeInSource, public readonly actualLocation: ActualLocation<ISource>) {
        super();
    }
}
