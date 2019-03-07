/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ILoadedSource } from '../internal/sources/loadedSource';
import { IBPRecipe } from '../internal/breakpoints/bpRecipe';
import { BidirectionalMap } from '../collections/bidirectionalMap';
import { injectable } from 'inversify';
import { IStackTracePresentationRow } from '../internal/stackTraces/stackTracePresentationRow';
import { ISource } from '../internal/sources/source';

export class BidirectionalHandles<T> {
    private readonly _idToObject = new BidirectionalMap<number, T>();

    constructor(private _nextHandle: number) { }

    public getObjectById(id: number): T {
        return this._idToObject.getByLeft(id);
    }

    public getIdByObject(obj: T): number {
        const id = this._idToObject.tryGettingByRight(obj);
        if (id !== undefined) {
            return id;
        } else {
            const newId = this._nextHandle++;
            this._idToObject.set(newId, obj);
            return newId;
        }
    }

    public toString(): string {
        return this._idToObject.toString();
    }
}

const prefixMultiplier = 1000000;

@injectable()
export class HandlesRegistry {
    // TODO DIEGO: V1 reseted the frames on an onPaused event. Figure out if that is the right thing to do
    // We use different prefixes so it's easier to identify the IDs in the logs...
    public readonly breakpoints = new BidirectionalHandles<IBPRecipe<ISource>>(888 * prefixMultiplier);
    public readonly frames = new BidirectionalHandles<IStackTracePresentationRow>(123 * prefixMultiplier);
    public readonly sources = new BidirectionalHandles<ILoadedSource>(555 * prefixMultiplier);

    public toString(): string {
        return `Handles {\nBPs:\n${this.breakpoints}\nFrames:\n${this.frames}\nSources:\n${this.sources}\n}`;
    }
}
