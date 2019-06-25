/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { IBPRecipeStatus } from '../bpRecipeStatus';

import { DebugProtocol } from 'vscode-debugprotocol';
import { HandlesRegistry } from '../../../client/handlesRegistry';
import { LocationInSourceToClientConverter } from '../../../client/locationInSourceToClientConverter';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { LineColTransformer } from '../../../../transformers/lineNumberTransformer';
import { ISourceToClientConverter } from '../../../client/sourceToClientConverter';

/**
 * Convert the status of a breakpoint recipe to a format that the client can understand
 */
@injectable()
export class BPRecipieStatusToClientConverter {
    private readonly _locationInSourceToClientConverter = new LocationInSourceToClientConverter(this._sourceToClientConverter, this._lineColTransformer);

    constructor(
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.SourceToClientConverter) private readonly _sourceToClientConverter: ISourceToClientConverter,
        @inject(TYPES.LineColTransformer) private readonly _lineColTransformer: LineColTransformer) { }

    public async toExistingBreakpoint(bpRecipeStatus: IBPRecipeStatus): Promise<DebugProtocol.Breakpoint> {
        const breakpointId = this._handlesRegistry.breakpoints.getExistingIdByObject(bpRecipeStatus.recipe);
        return await this.toBreakpointWithId(breakpointId, bpRecipeStatus);
    }

    public async toBreakpoint(bpRecipeStatus: IBPRecipeStatus): Promise<DebugProtocol.Breakpoint> {
        const breakpointId = this._handlesRegistry.breakpoints.getIdByObject(bpRecipeStatus.recipe);
        return await this.toBreakpointWithId(breakpointId, bpRecipeStatus);
    }

    private async toBreakpointWithId(breakpointId: number, bpRecipeStatus: IBPRecipeStatus): Promise<DebugProtocol.Breakpoint> {
        const clientStatus: DebugProtocol.Breakpoint = {
            id: breakpointId,
            verified: bpRecipeStatus.isVerified(),
            message: bpRecipeStatus.statusDescription
        };

        await bpRecipeStatus.ifHasActualLocation(async actualLocation => {
            await this._locationInSourceToClientConverter.toLocationInSource(actualLocation, clientStatus);
        }, () => { });

        return clientStatus;
    }
}