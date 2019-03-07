import * as pathModule from 'path';
import * as utils from '../../utils';
import { ILoadedSource } from '../internal/sources/loadedSource';
import { Source } from 'vscode-debugadapter';
import { HandlesRegistry } from './handlesRegistry';

export class SourceToClientConverter {
    constructor(private readonly _handlesRegistry: HandlesRegistry) { }

    public async toSource(loadedSource: ILoadedSource): Promise<Source> {
        const exists = await utils.existsAsync(loadedSource.identifier.canonicalized);

        // if the path exists, do not send the sourceReference
        // new Source sends 0 for undefined
        const source: Source = {
            name: pathModule.basename(loadedSource.identifier.textRepresentation),
            path: loadedSource.identifier.textRepresentation,
            sourceReference: exists ? undefined : this._handlesRegistry.sources.getIdByObject(loadedSource),
        };

        return source;
    }
}