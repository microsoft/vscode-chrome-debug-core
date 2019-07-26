/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { RangeInResource, Range } from './rangeInScript';
import { LocationInScript, Location } from './location';
import { printArray } from '../../collections/printing';
import { IHasSourceMappingInformation } from '../scripts/IHasSourceMappingInformation';
import { IScript } from '../scripts/script';
import { InternalError } from '../../utils/internalError';

export interface IMappedTokensInScript<T extends IHasSourceMappingInformation = IHasSourceMappingInformation> {
    readonly script: T;
    readonly enclosingRange: RangeInResource<T>;

    isEmpty(): boolean;
}

export class MappedTokensInScript<T extends IHasSourceMappingInformation = IHasSourceMappingInformation> implements IMappedTokensInScript<T> {
    public constructor(public readonly script: T, private readonly _ranges: Range[]) {
        if (this._ranges.length === 0) {
            throw new InternalError('error.mappedTokens.rangesListIsEmpty', 'Expected the mapped tokens to have a non empty list of ranges where the tokens are located');
        }

        const emptyRanges = this._ranges.filter(range => range.isEmpty());
        if (emptyRanges.length > 0) {
            throw new InternalError('error..mappedTokens.rangesAreEmpty',
                `Expected all the ranges of mapped tokens to have a list of non empty ranges, yet these ranges were empty: ${printArray('', emptyRanges)}`);
        }
    }

    public static characterAt<T extends IHasSourceMappingInformation>(characterLocation: Location<T>): IMappedTokensInScript<T> {
        return new MappedTokensInScript<T>(characterLocation.resource, [Range.at(characterLocation.position)]);
    }

    public static untilNextLine(characterLocation: LocationInScript): IMappedTokensInScript<IScript> {
        return new MappedTokensInScript(characterLocation.script, [Range.untilNextLine(characterLocation.position)]);
    }

    public get enclosingRange(): RangeInResource<T> {
        return new RangeInResource(this.script, Range.enclosingAll(this._ranges));
    }

    public isEmpty(): boolean {
        return false;
    }

    public toString(): string {
        return printArray('Mapped to script tokens at:', this._ranges);
    }
}

export class NoMappedTokensInScript<T extends IHasSourceMappingInformation = IHasSourceMappingInformation> implements IMappedTokensInScript<T> {
    public constructor(public readonly script: T) { }

    public get ranges(): never {
        throw new InternalError('error.noMappedTokens.cantGetRanges', "Can't get the ranges when the source mapped to no tokens on the script");
    }

    public get enclosingRange(): never {
        throw new InternalError('error.noMappedTokens.cantGetEnclosingRange', "Can't get the enclosing range when the source mapped to no tokens on the script");
    }

    public isEmpty(): boolean {
        return true;
    }

    public toString(): string {
        return `Didn't map to any script tokens`;
    }
}