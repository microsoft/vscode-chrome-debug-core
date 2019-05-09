import { BasePathTransformer } from './basePathTransformer';
import { inject } from 'inversify';
import { TYPES } from '../chrome/dependencyInjection.ts/types';
import { IConnectedCDAConfiguration } from '../chrome/client/chromeDebugAdapter/cdaConfiguration';
import { FallbackToClientPathTransformer } from './fallbackToClientPathTransformer';
import { RemotePathTransformer } from './remotePathTransformer';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IStackTracePresentation } from '../chrome/internal/stackTraces/stackTracePresentation';
import { IResourceIdentifier } from '../chrome/internal/sources/resourceIdentifier';
import { isTrue } from '../chrome/utils/typedOperators';
import * as _ from 'lodash';

/**
 * We use this class to be able to choose between different path transformer classes based on the supportsMapURLToFilePathRequest parameter
 */
export class ConfigurationBasedPathTransformer extends BasePathTransformer {
    private readonly _pathTransformer: BasePathTransformer;

    constructor(@inject(TYPES.ConnectedCDAConfiguration) private readonly configuration: IConnectedCDAConfiguration) {
        super();
        const pathTransformerClass = isTrue(this.configuration.clientCapabilities.supportsMapURLToFilePathRequest)
            ? FallbackToClientPathTransformer
            : _.defaultTo(this.configuration.extensibilityPoints.pathTransformer, RemotePathTransformer);
        this._pathTransformer = new pathTransformerClass(configuration);
    }

    public clearTargetContext(): void {
        return this._pathTransformer.clearTargetContext();
    }

    public scriptParsed(scriptPath: IResourceIdentifier): Promise<IResourceIdentifier> {
        return this._pathTransformer.scriptParsed(scriptPath);
    }

    public breakpointResolved(_bp: DebugProtocol.Breakpoint, targetPath: IResourceIdentifier): IResourceIdentifier {
        return this._pathTransformer.breakpointResolved(_bp, targetPath);
    }

    public stackTraceResponse(_response: IStackTracePresentation): void {
        return this._pathTransformer.stackTraceResponse(_response);
    }

    public async fixSource(_source: DebugProtocol.Source): Promise<void> {
        return this._pathTransformer.fixSource(_source);
    }

    public getTargetPathFromClientPath(clientPath: IResourceIdentifier): IResourceIdentifier {
        return this._pathTransformer.getTargetPathFromClientPath(clientPath);
    }

    public getClientPathFromTargetPath(targetPath: IResourceIdentifier): IResourceIdentifier | undefined {
        return this._pathTransformer.getClientPathFromTargetPath(targetPath);
    }
}