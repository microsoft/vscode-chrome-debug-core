import { LineNumber, ColumnNumber } from '../locations/subtypes';
import { SourceMap } from '../../../sourceMaps/sourceMap';

export interface ISourcesMapper {
    readonly sources: string[];
    getSourcePosition(positionInScript: IPositionInScript): IPositionInSource | null;
    getScriptPosition(positionInSource: IPositionInSource): IPositionInScript | null;
}

interface IPositionInSource {
    readonly source: string;
    readonly line: LineNumber;
    readonly column?: ColumnNumber;
}

interface IPositionInScript {
    readonly line: LineNumber;
    readonly column?: ColumnNumber;
}

/** This class maps locations from a script into the sources form which it was compiled, and back. */
export class SourcesMapper implements ISourcesMapper {
    public getSourcePosition(positionInScript: IPositionInScript): IPositionInSource | null {
        const mappedPosition = this._sourceMap.authoredPositionFor(positionInScript.line, positionInScript.column || 0);
        return mappedPosition && mappedPosition.source && mappedPosition.line
            ? { source: mappedPosition.source, line: mappedPosition.line as LineNumber, column: mappedPosition.column as ColumnNumber }
            : null;
    }

    public getScriptPosition(positionInSource: IPositionInSource): IPositionInScript | null {
        const mappedPosition = this._sourceMap.generatedPositionFor(positionInSource.source,
            positionInSource.line, positionInSource.column || 0);
        return mappedPosition && mappedPosition.line
            ? { line: mappedPosition.line as LineNumber, column: mappedPosition.column as ColumnNumber }
            : null;
    }

    public get sources(): string[] {
        return this._sourceMap.authoredSources || [];
    }

    constructor(private readonly _sourceMap: SourceMap) { }

}

export class NoSourceMapping implements ISourcesMapper {
    public getSourcePosition(_: IPositionInScript): null {
        return null;
    }

    public getScriptPosition(_: IPositionInSource): null {
        return null;
    }

    public get sources(): [] {
        return [];
    }
}