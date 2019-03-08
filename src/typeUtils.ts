/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/**
 * Type utilities to construct derived types from the original types, rather than have to manually write them
 */
export type MakePropertyRequired<T, K extends keyof T> = T & { [P in K]-?: T[K] };
export type RemoveProperty<T, K> = Pick<T, Exclude<keyof T, K>>;
