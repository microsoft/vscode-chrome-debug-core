/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { SourceAlreadyResolvedToLoadedSource, ISource } from '../internal/sources/source';
import { HandlesRegistry } from './handlesRegistry';
import { ILoadedSource } from '../internal/sources/loadedSource';
import { parseResourceIdentifier } from '../internal/sources/resourceIdentifier';
import { SourceResolver } from '../internal/sources/sourceResolver';
import { isNotEmpty, isUndefined, isDefined } from '../utils/typedOperators';
import { InternalError } from '../utils/internalError';

/**
 * Class used to parse a source of the VS Code protocol into the internal source model
 */
export class ClientSourceParser {
    constructor(
        private readonly _handlesRegistry: HandlesRegistry,
        private readonly _sourceResolver: SourceResolver) { }

    public toSource(clientSource: DebugProtocol.Source): ISource {
        if (isNotEmpty(clientSource.path) && isUndefined(clientSource.sourceReference)) {
            const identifier = parseResourceIdentifier(clientSource.path);
            return this._sourceResolver.createUnresolvedSource(identifier);
        } else if (isDefined(clientSource.sourceReference)) {
            const source = this.getSourceFromId(clientSource.sourceReference);
            return new SourceAlreadyResolvedToLoadedSource(source);
        } else {
            throw new InternalError('error.clientSourceParser.doesntHaveExactlyOneOfPathOrReference',
                `Expected the source to have a path (${clientSource.path}) either-or a source reference (${clientSource.sourceReference})`);
        }
    }

    public getSourceFromId(handle: number): ILoadedSource {
        return this._handlesRegistry.sources.getObjectById(handle);
    }
}