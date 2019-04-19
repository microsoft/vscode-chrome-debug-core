import * as pathModule from 'path';
import * as utils from '../../utils';
import { ILoadedSource } from '../internal/sources/loadedSource';
import { HandlesRegistry } from './handlesRegistry';
import { DebugProtocol } from 'vscode-debugprotocol';
import { LocalFileURL } from '../internal/sources/resourceIdentifier';

export class SourceToClientConverter {
    constructor(private readonly _handlesRegistry: HandlesRegistry) { }

    public async toSource(loadedSource: ILoadedSource): Promise<DebugProtocol.Source> {
        const exists = await utils.existsAsync(loadedSource.identifier.canonicalized);

        const sourceIdentifier = loadedSource.identifier;
        const sourceTextRepresentation = sourceIdentifier instanceof LocalFileURL
            ? sourceIdentifier.filePathRepresentation
            : sourceIdentifier.textRepresentation;

        // if the path exists, do not send the sourceReference
        // new Source sends 0 for undefined
        const source = {
            name: pathModule.basename(sourceTextRepresentation),
            path: sourceTextRepresentation,
            sourceReference: exists ? undefined : this._handlesRegistry.sources.getIdByObject(loadedSource),
        };

        return source;
    }
}