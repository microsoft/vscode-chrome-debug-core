import { RangeInScript, RangeInResource } from './rangeInScript';
import { IScript } from '../../..';
import { LocationInScript } from './location';
import { printArray } from '../../collections/printing';

export interface IMappedTokensInScript {
    readonly script: IScript;
    readonly ranges: RangeInScript[];
    readonly enclosingRange: RangeInScript;

    isEmpty(): boolean;
}

export class MappedTokensInScript implements IMappedTokensInScript {
    public constructor(public readonly script: IScript, public readonly ranges: RangeInScript[]) {
        if (this.ranges.length === 0) {
            throw new Error(`Expected the mapped tokens to have a non empty list of ranges where the tokens are located`);
        }
    }

    public static characterAt(characterLocation: LocationInScript): IMappedTokensInScript {
        return new MappedTokensInScript(characterLocation.script, [RangeInResource.characterAt(characterLocation)]);
    }

    public get enclosingRange(): RangeInScript {
        return RangeInResource.enclosingAll(this.ranges);
    }

    public isEmpty(): boolean {
        return false;
    }

    public toString(): string {
        return printArray('Mapped to script tokens at:', this.ranges);
    }
}

export class NoMappedTokensInScript implements IMappedTokensInScript {
    public constructor(public readonly script: IScript) { }

    public get ranges(): never {
        throw new Error(`Can't get the ranges when the source mapped to no tokens on the script`);
    }

    public get enclosingRange(): never {
        throw new Error(`Can't get the enclosing range when the source mapped to no tokens on the script`);
    }

    public isEmpty(): boolean {
        return true;
    }

    public toString(): string {
        return `Didn't map to any script tokens`;
    }
}