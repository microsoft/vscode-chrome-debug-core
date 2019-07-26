/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../features/components';
import { injectable, inject } from 'inversify';
import { ClientSourceParser } from '../../client/clientSourceParser';
import { HandlesRegistry } from '../../client/handlesRegistry';
import { ISourcesRetriever } from './sourcesRetriever';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ITelemetryPropertyCollector } from '../../../telemetry';
import { ISourceResponseBody, IGetLoadedSourcesResponseBody } from '../../../debugAdapterInterfaces';
import { ILoadedSourceTreeNode } from './loadedSource';
import { asyncMap } from '../../collections/async';
import { ISourceToClientConverter } from '../../client/sourceToClientConverter';
import { SourceResolver } from './sourceResolver';
import { isDefined } from '../../utils/typedOperators';
import { TYPES } from '../../dependencyInjection.ts/types';
import { InternalError } from '../../utils/internalError';

@injectable()
export class SourceRequestHandler implements ICommandHandlerDeclarer {
    private readonly _clientSourceParser = new ClientSourceParser(this._handlesRegistry, this._sourcesResolver);

    public constructor(
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.SourceToClientConverter) private readonly _sourceToClientConverter: ISourceToClientConverter,
        private readonly _sourcesResolver: SourceResolver,
        @inject(TYPES.ISourcesRetriever) private readonly _sourcesRetriever: ISourcesRetriever) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            source: (args: DebugProtocol.SourceArguments) => this.source(args),
            loadedSources: () => this.loadedSources(),
        });
    }

    public async loadedSources(): Promise<IGetLoadedSourcesResponseBody> {
        return { sources: await asyncMap(await this._sourcesRetriever.loadedSourcesTrees(), st => this.toSourceTree(st)) };
    }

    public async source(args: DebugProtocol.SourceArguments, _telemetryPropertyCollector?: ITelemetryPropertyCollector, _requestSeq?: number): Promise<ISourceResponseBody> {
        if (isDefined(args.source)) {
            const source = this._clientSourceParser.toSource(args.source);
            const sourceText = await this._sourcesRetriever.text(source);
            return {
                content: sourceText,
                mimeType: 'text/javascript'
            };
        } else {
            throw new InternalError('error.source.lacksSourceArg',
                `Expected the source request to have a source argument yet it was ${args.source}`);
        }
    }

    private toSourceLeafs(sources: ILoadedSourceTreeNode[]): Promise<DebugProtocol.Source[]> {
        return Promise.all(sources.map(source => this.toSourceTree(source)));
    }

    private async toSourceTree(sourceMetadata: ILoadedSourceTreeNode): Promise<DebugProtocol.Source> {
        const source = await this._sourceToClientConverter.toSource(sourceMetadata.mainSource);
        (source as any).sources = await this.toSourceLeafs(sourceMetadata.relatedSources);
        return source;
    }
}