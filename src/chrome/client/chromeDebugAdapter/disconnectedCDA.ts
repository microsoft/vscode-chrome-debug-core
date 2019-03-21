/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { injectable } from 'inversify';
import { BaseCDAState } from './baseCDAState';

@injectable()
export class DisconnectedCDA extends BaseCDAState {
    constructor() {
        super([], {});
    }
}
