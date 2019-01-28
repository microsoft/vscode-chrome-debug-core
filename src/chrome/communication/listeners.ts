/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

type Callback<Args, Result> = (args: Args) => Result;

/**
 * This class is used to manage and call a set of listeners, such as the listeners to onScriptParsed
 */
export class Listeners<Args, Result> {
    private readonly _listeners = [] as Callback<Args, Result>[];

    public add(listener: Callback<Args, Result>): void {
        this._listeners.push(listener);
    }

    public call(args: Args): Result[] {
        return this._listeners.map(listener => listener(args));
    }

    public hasListeners(): boolean {
        return this._listeners.length > 0;
    }
}