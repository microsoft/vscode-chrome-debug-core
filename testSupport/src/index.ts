/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {ExtendedDebugClient, IExpectedStopLocation, THREAD_ID} from './debugClient';
import * as debugClient from './debugClient';
import {setup, teardown, ISetupOpts} from './testSetup';

export {
    ExtendedDebugClient,
    IExpectedStopLocation,
    THREAD_ID,

    debugClient,

    setup,
    teardown,
    ISetupOpts
};