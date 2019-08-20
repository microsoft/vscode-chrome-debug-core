/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';

import { LocationInScript, LocationInLoadedSource } from '../locations/location';
import { IScript } from '../scripts/script';
import { URLRegexp } from '../locations/subtypes';
import { IResourceIdentifier, IURL } from '../sources/resourceIdentifier';
import { CDTPScriptUrl } from '../sources/resourceIdentifierSubtypes';
import { ISource } from '../sources/source';
import { IBPRecipeForRuntimeSource } from './baseMappedBPRecipe';
import { BPRecipeInSource } from './bpRecipeInSource';
import { IBPRecipe, BPInScriptSupportedHitActions } from './bpRecipe';
import { registerGetLocalize } from '../../utils/localization';
import { InternalError } from '../../utils/internalError';
import { PauseOnHitCount } from './bpActionWhenHit';

let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

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
        return localize('breakpoint.bound.description', '{0} actual location is {1}', `${this.recipe}`, this.actualLocation.toString());
    }
}

type MappableBPPossibleResources = IScript | IResourceIdentifier<CDTPScriptUrl> | URLRegexp;
export class MappableBreakpoint<TResource extends MappableBPPossibleResources> extends BaseBreakpoint<TResource> {
    constructor(public readonly recipe: IBPRecipeForRuntimeSource<TResource, BPInScriptSupportedHitActions>, public readonly actualLocation: ActualLocation<TResource>) {
        super();
    }

    public copyReplacingBPRecipe(bpRecipe: BPRecipeInSource): BreakpointInSource {
        const locationInSource = this.actualLocation.mappedToSource();
        if (locationInSource.resourceIdentifier.isEquivalentTo(bpRecipe.location.resourceIdentifier) &&
              locationInSource.position.isEquivalentTo(bpRecipe.location.position)) {
            return new BreakpointInSource(bpRecipe, locationInSource);
        } else {
            throw new InternalError('error.breakpoint.mismatchedLocation',
                `Can't re-create the breakpoint with a recipe located in a different place. Original location: ${this.recipe.location}. Replacement: ${bpRecipe.location}`);
        }
    }

    public mappedToSource(): BreakpointInSource {
        return new BreakpointInSource(this.recipe.unmappedBPRecipe, this.actualLocation.mappedToSource());
    }
}

export class BreakpointInScript extends MappableBreakpoint<IScript> { }

export class BreakpointInUrl extends MappableBreakpoint<IURL<CDTPScriptUrl>> { }

export class BreakpointInSource extends BaseBreakpoint<ISource> {
    constructor(public readonly recipe: BPRecipeInSource, public readonly actualLocation: ActualLocation<ISource>) {
        super();
    }

    public copyReplacingBPRecipe(bpRecipe: BPRecipeInSource<PauseOnHitCount>): BreakpointInSource {
        if (this.recipe.location.resourceIdentifier.isEquivalentTo(bpRecipe.location.resourceIdentifier) &&
            this.recipe.location.position.isEquivalentTo(bpRecipe.location.position)) {
            return new BreakpointInSource(bpRecipe, this.actualLocation);
        } else {
            throw new InternalError('error.breakpoint.source.mismatchedLocation',
                `Can't re-create the breakpoint with a recipe located in a different place. Original location: ${this.recipe.location}. Replacement: ${bpRecipe.location}`);
        }
    }
}
