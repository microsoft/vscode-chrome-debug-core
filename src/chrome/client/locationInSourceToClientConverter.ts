import { HandlesRegistry } from './handlesRegistry';
import { LocationInLoadedSource } from '../internal/locations/location';
import { SourceToClientConverter } from './sourceToClientConverter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { LineColTransformer } from '../../transformers/lineNumberTransformer';

interface IClientLocationInSource {
    source: DebugProtocol.Source;
    line: number;
    column: number;
}

export class LocationInSourceToClientConverter {
    private readonly _sourceToClientConverter = new SourceToClientConverter(this._handlesRegistry);

    constructor(
        private readonly _handlesRegistry: HandlesRegistry,
        private readonly _lineColTransformer: LineColTransformer) { }

    public async toLocationInSource<T = {}>(locationInSource: LocationInLoadedSource, objectToUpdate: T): Promise<T & IClientLocationInSource> {
        const source = await this._sourceToClientConverter.toSource(locationInSource.source);
        const clientLocationInSource = { source, line: locationInSource.position.lineNumber, column: locationInSource.position.columnNumber };
        this._lineColTransformer.convertDebuggerLocationToClient(clientLocationInSource);
        return Object.assign(objectToUpdate, clientLocationInSource);
    }
}