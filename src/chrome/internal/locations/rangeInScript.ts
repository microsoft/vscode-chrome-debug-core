import { Coordinates, LocationInScript } from './location';
import { IScript } from '../scripts/script';

export class RangeInScript {
    constructor(
        public readonly script: IScript,
        public readonly start: Coordinates,
        public readonly end: Coordinates) {
        if (start.lineNumber > end.lineNumber
            || (start.lineNumber === end.lineNumber && start.columnNumber > end.columnNumber)) {
            throw new Error(`Can't create a range in a script ${script.runtimeSource} where the end position (${end}) happens before the start position ${start}`);
        }
    }

    public get startInScript(): LocationInScript {
        return new LocationInScript(this.script, this.start);
    }

    public get endInScript(): LocationInScript {
        return new LocationInScript(this.script, this.end);
    }
}
