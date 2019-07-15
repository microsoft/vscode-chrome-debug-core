/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { injectable, inject } from 'inversify';
import { BaseCDAState } from './baseCDAState';
import { ISession } from '../session';
import { TYPES } from '../../dependencyInjection.ts/types';

@injectable()
export class TerminatedCDA extends BaseCDAState {
    constructor(@inject(TYPES.ISession) protected readonly _session: ISession) {
        super([], {});
    }

    public toString(): string {
        return `Terminated the debug session`;
    }
}
