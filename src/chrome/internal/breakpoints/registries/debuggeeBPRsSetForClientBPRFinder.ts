/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { ISource } from '../../sources/source';
import { IBPRecipe } from '../bpRecipe';
import { CDTPBPRecipe } from '../../../cdtpDebuggee/cdtpPrimitives';
import { ValidatedMultiMap } from '../../../collections/validatedMultiMap';
import { IBreakpointsEventsListener } from '../features/breakpointsEventSystem';
import { injectable, inject, LazyServiceIdentifer } from 'inversify';
import { PrivateTypes } from '../diTypes';

type ClientBPRecipe = IBPRecipe<ISource>;
type DebuggeeBPRecipe = CDTPBPRecipe;

/**
 * Find all the debuggee breakpoint recipes we set for a particular client breakpoint recipe
 */
@injectable()
export class DebuggeeBPRsSetForClientBPRFinder {
    private readonly _clientBPRToDebuggeeBPRItSet = ValidatedMultiMap.empty<ClientBPRecipe, DebuggeeBPRecipe>();

    public constructor(@inject(new LazyServiceIdentifer(() => PrivateTypes.IBreakpointsEventsListener)) breakpointsEventsListener: IBreakpointsEventsListener) {
        breakpointsEventsListener.listenForOnClientBPRecipeAdded(clientBPRecipe => this.clientBPRWasAdded(clientBPRecipe));
        breakpointsEventsListener.listenForOnDebuggeeBPRecipeAdded(debuggeeBPRecipe => this.debuggeeBPRsWasAdded(debuggeeBPRecipe));
        breakpointsEventsListener.listenForOnDebuggeeBPRecipeRemoved(debuggeeBPRecipe => this.debuggeeBPRsWasRemoved(debuggeeBPRecipe));
        breakpointsEventsListener.listenForOnClientBPRecipeRemoved(clientBPRecipe => this.clientBPRWasRemoved(clientBPRecipe));
    }

    public findDebuggeeBPRsSet(clientBPRecipe: ClientBPRecipe): DebuggeeBPRecipe[] {
        // TODO: Review if it's okay to use getOr here, or if we should use get instead
        return Array.from(this._clientBPRToDebuggeeBPRItSet.getOr(clientBPRecipe, () => new Set()));
    }

    public containsBPRecipe(bpRecipe: ClientBPRecipe): boolean {
        return this._clientBPRToDebuggeeBPRItSet.has(bpRecipe);
    }

    private clientBPRWasAdded(clientBPRecipe: ClientBPRecipe): void {
        this._clientBPRToDebuggeeBPRItSet.addKeyIfNotExistant(clientBPRecipe);
    }

    private debuggeeBPRsWasAdded(debuggeeBPRecipe: DebuggeeBPRecipe): void {
        /**
         * If we load the same script two times, we'll try to register the same client BP
         * with the same debuggee BP twice, so we need to allow duplicates
         */
        this._clientBPRToDebuggeeBPRItSet.addAndIgnoreDuplicates(debuggeeBPRecipe.unmappedBPRecipe, debuggeeBPRecipe);
    }

    private debuggeeBPRsWasRemoved(debuggeeBPRecipe: DebuggeeBPRecipe): void {
        this._clientBPRToDebuggeeBPRItSet.removeValue(debuggeeBPRecipe.unmappedBPRecipe, debuggeeBPRecipe);
    }

    private clientBPRWasRemoved(clientBPRecipe: ClientBPRecipe): void {
        const debuggeBPRecipies = this._clientBPRToDebuggeeBPRItSet.get(clientBPRecipe);
        if (debuggeBPRecipies.size >= 1) {
            throw new Error(localize('error.debuggeeToClientBprsMap.cantRemoveBprWithReferences', 'Tried to remove a Client breakpoint recipe ({0}) which still had some '
                + `associated debuggee breakpoint recipes ({1})`, `${clientBPRecipe}`, `${debuggeBPRecipies}`));
        }

        this._clientBPRToDebuggeeBPRItSet.delete(clientBPRecipe);
    }

    public toString(): string {
        return `Debuggee BPRs set for Client BPR finder: ${this._clientBPRToDebuggeeBPRItSet}`;
    }
}
