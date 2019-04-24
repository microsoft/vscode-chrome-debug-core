import { asyncMap } from '../collections/async';

/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export type PromiseOrNot<T> = Promise<T> | T;

/**
 * Wait until the promise gets either resolved or rejected. If the promise gets rejected, waitForEnd will ignore that rejection and succeed anyways.
 */
export async function waitForEnd(...manyPromisesToWaitFor: Promise<unknown>[]): Promise<void> {
    await asyncMap(manyPromisesToWaitFor, waitForSinglePromiseToEnd);
}

async function waitForSinglePromiseToEnd(promiseToWaitFor: Promise<unknown>): Promise<void> {
    try {
        await promiseToWaitFor;
    } catch {
        // Ignore failures
    }
}
