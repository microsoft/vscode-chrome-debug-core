/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { BaseSourceMapTransformer } from '../../../../transformers/baseSourceMapTransformer';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { determineOrderingOfStrings } from '../../../collections/utilities';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { IScript } from '../../scripts/script';
import { CDTPScriptsRegistry } from '../../../cdtpDebuggee/registries/cdtpScriptsRegistry';
import { IScriptSourcesRetriever } from '../../../cdtpDebuggee/features/cdtpScriptSourcesRetriever';
import { parseResourceIdentifier } from '../resourceIdentifier';

@injectable()
export class DotScriptCommand {
    constructor(
        @inject(TYPES.BaseSourceMapTransformer) private readonly _sourceMapTransformer: BaseSourceMapTransformer,
        @inject(TYPES.IScriptSources) private readonly _scriptSources: IScriptSourcesRetriever,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter,
        @inject(TYPES.CDTPScriptsRegistry) private readonly _scriptsRegistry: CDTPScriptsRegistry) { }

    /**
     * Handle the .scripts command, which can be used as `.scripts` to return a list of all script details,
     * or `.scripts <url>` to show the contents of the given script.
     */
    public handleScriptsCommand(scriptsRest: string): Promise<void> {
        let outputStringP: Promise<string>;
        if (scriptsRest) {
            // `.scripts <url>` was used, look up the script by url
            const requestedScript = this._scriptsRegistry.getScriptsByPath(parseResourceIdentifier(scriptsRest));
            if (requestedScript) {
                outputStringP = this._scriptSources.getScriptSource(requestedScript[0])
                    .then(result => {
                        const maxLength = 1e5;
                        return result.length > maxLength ?
                            result.substr(0, maxLength) + '[⋯]' :
                            result;
                    });
            } else {
                outputStringP = Promise.resolve(`No runtime script with url: ${scriptsRest}\n`);
            }
        } else {
            outputStringP = this.getAllScriptsString();
        }

        return outputStringP.then(scriptsStr => {
            this._eventsToClientReporter.sendOutput({ output: scriptsStr, category: null });
        });
    }

    private async getAllScriptsString(): Promise<string> {
        const scripts = (await Promise.all([
            ...this._scriptsRegistry.getAllScripts()
        ])).sort((left, script) => determineOrderingOfStrings(left.url, script.url));

        const scriptsPrinted = await Promise.all(scripts.map(script => this.getOneScriptString(script)));
        return scriptsPrinted.join('\n');
    }

    private async getOneScriptString(script: IScript): Promise<string> {
        let result = '› ' + script.runtimeSource.identifier.textRepresentation;
        const clientPath = script.developmentSource.identifier.textRepresentation;
        if (script.developmentSource !== script.runtimeSource) result += ` (${clientPath})`;

        const sourcePathDetails = await this._sourceMapTransformer.allSourcePathDetails(script.runtimeSource.identifier.canonicalized);
        let mappedSourcesStr = sourcePathDetails.map(details => `    - ${details.originalPath} (${details.inferredPath})`).join('\n');
        if (sourcePathDetails.length) {
            mappedSourcesStr = '\n' + mappedSourcesStr;
        }

        return result + mappedSourcesStr;
    }
}
