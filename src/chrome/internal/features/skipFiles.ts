import { IToggleSkipFileStatusArgs, utils, Crdp, BaseSourceMapTransformer, parseResourceIdentifier } from '../../..';
import { logger } from 'vscode-debugadapter/lib/logger';
import { IScript } from '../scripts/script';
import { BasePathTransformer } from '../../../transformers/basePathTransformer';
import { CDTPDiagnostics } from '../../target/cdtpDiagnostics';
import { StackTracesLogic, IStackTracePresentationLogicProvider } from '../stackTraces/stackTracesLogic';
import { newResourceIdentifierMap, IResourceIdentifier, parseResourceIdentifiers } from '../sources/resourceIdentifier';
import { IComponent } from './feature';
import { ScriptParsedEvent } from '../../target/events';
import { LocationInLoadedSource } from '../locations/location';
import { ICallFramePresentationDetails } from '../stackTraces/callFramePresentation';
import * as nls from 'vscode-nls';
import { injectable, inject } from 'inversify';
import { DeleteMeScriptsRegistry } from '../scripts/scriptsRegistry';
import { TYPES } from '../../dependencyInjection.ts/types';
const localize = nls.loadMessageBundle();

export interface EventsConsumedBySkipFilesLogic {
    onScriptParsed(listener: (scriptEvent: ScriptParsedEvent) => Promise<void>): void;
}

export interface ISkipFilesConfiguration {
    skipFiles?: string[]; // an array of file names or glob patterns
    skipFileRegExps?: string[]; // a supplemental array of library code regex patterns
}

@injectable()
export class SkipFilesLogic implements IComponent<ISkipFilesConfiguration>, IStackTracePresentationLogicProvider {
    private _blackboxedRegexes: RegExp[] = [];
    private _skipFileStatuses = newResourceIdentifierMap<boolean>();
    public reprocessPausedEvent: () => void; // TODO DIEGO: Do this in a better way

    /**
     * If the source has a saved skip status, return that, whether true or false.
     * If not, check it against the patterns list.
     */
    public shouldSkipSource(sourcePath: IResourceIdentifier): boolean | undefined {
        const status = this.getSkipStatus(sourcePath);
        if (typeof status === 'boolean') {
            return status;
        }

        if (this.matchesSkipFilesPatterns(sourcePath)) {
            return true;
        }

        return undefined;
    }

    public getCallFrameAdditionalDetails(locationInLoadedSource: LocationInLoadedSource): ICallFramePresentationDetails[] {
        return this.shouldSkipSource(locationInLoadedSource.source.identifier)
            ? [{
                additionalSourceOrigins: [localize('skipFilesFeatureName', 'skipFiles')],
                sourcePresentationHint: 'deemphasize'
            }]
            : [];
    }

    /**
     * Returns true if this path matches one of the static skip patterns
     */
    private matchesSkipFilesPatterns(sourcePath: IResourceIdentifier): boolean {
        return this._blackboxedRegexes.some(regex => {
            return regex.test(sourcePath.canonicalized);
        });
    }

    /**
     * Returns the current skip status for this path, which is either an authored or generated script.
     */
    private getSkipStatus(sourcePath: IResourceIdentifier): boolean | undefined {
        if (this._skipFileStatuses.has(sourcePath)) {
            return this._skipFileStatuses.get(sourcePath);
        }

        return undefined;
    }

    /* __GDPR__
        'ClientRequest/toggleSkipFileStatus' : {
            '${include}': [
                '${IExecutionResultTelemetryProperties}',
                '${DebugCommonProperties}'
            ]
        }
    */
    public async toggleSkipFileStatus(args: IToggleSkipFileStatusArgs): Promise<void> {
        if (!await this.isInCurrentStack(args)) {
            // Only valid for files that are in the current stack
            const logName = args.source;
            logger.log(`Can't toggle the skipFile status for ${logName} - it's not in the current stack.`);
            return;
        }

        const aPath = args.source;
        const generatedPath = parseResourceIdentifier(await this.sourceMapTransformer.getGeneratedPathFromAuthoredPath(aPath.canonicalized));
        if (!generatedPath) {
            logger.log(`Can't toggle the skipFile status for: ${aPath} - haven't seen it yet.`);
            return;
        }

        const sources = parseResourceIdentifiers(await this.sourceMapTransformer.allSources(generatedPath.canonicalized));
        if (generatedPath.isEquivalent(aPath) && sources.length) {
            // Ignore toggling skip status for generated scripts with sources
            logger.log(`Can't toggle skipFile status for ${aPath} - it's a script with a sourcemap`);
            return;
        }

        const newStatus = !this.shouldSkipSource(aPath);
        logger.log(`Setting the skip file status for: ${aPath} to ${newStatus}`);
        this._skipFileStatuses.set(aPath, newStatus);

        const targetPath = this.pathTransformer.getTargetPathFromClientPath(generatedPath) || generatedPath;
        const script = this.getScriptByUrl(targetPath)[0];

        await this.resolveSkipFiles(script, generatedPath, sources, /*toggling=*/true);

        if (newStatus) {
            // TODO: Verify that using targetPath works here. We need targetPath to be this.getScriptByUrl(targetPath).url
            this.makeRegexesSkip(script.runtimeSource.identifier.textRepresentation);
        } else {
            this.makeRegexesNotSkip(script.runtimeSource.identifier.textRepresentation);
        }

        this.reprocessPausedEvent();
    }

    private makeRegexesSkip(skipPath: string): void {
        let somethingChanged = false;
        this._blackboxedRegexes = this._blackboxedRegexes.map(regex => {
            const result = utils.makeRegexMatchPath(regex, skipPath);
            somethingChanged = somethingChanged || (result !== regex);
            return result;
        });

        if (!somethingChanged) {
            this._blackboxedRegexes.push(new RegExp(utils.pathToRegex(skipPath), 'i'));
        }

        this.refreshBlackboxPatterns();
    }

    private refreshBlackboxPatterns(): void {
        // Make sure debugging domain is enabled before calling refreshBlackboxPatterns()
        this.chrome.Debugger.setBlackboxPatterns({
            patterns: this._blackboxedRegexes.map(regex => regex.source)
        }).catch(() => this.warnNoSkipFiles());
    }

    private async isInCurrentStack(args: IToggleSkipFileStatusArgs): Promise<boolean> {
        const currentStack = await this.stackTracesLogic.stackTrace({ threadId: undefined });

        return currentStack.stackFrames.some(frame => {
            return frame.hasCodeFlow()
                && frame.codeFlow.location.source
                && frame.codeFlow.location.source.identifier.isEquivalent(args.source);
        });
    }

    private makeRegexesNotSkip(noSkipPath: string): void {
        let somethingChanged = false;
        this._blackboxedRegexes = this._blackboxedRegexes.map(regex => {
            const result = utils.makeRegexNotMatchPath(regex, noSkipPath);
            somethingChanged = somethingChanged || (result !== regex);
            return result;
        });

        if (somethingChanged) {
            this.refreshBlackboxPatterns();
        }
    }

    public async resolveSkipFiles(script: IScript, mappedUrl: IResourceIdentifier, sources: IResourceIdentifier[], toggling?: boolean): Promise<void> {
        if (sources && sources.length) {
            const parentIsSkipped = this.shouldSkipSource(script.runtimeSource.identifier);
            const libPositions: Crdp.Debugger.ScriptPosition[] = [];

            // Figure out skip/noskip transitions within script
            let inLibRange = parentIsSkipped;
            for (let s of sources) {
                let isSkippedFile = this.shouldSkipSource(s);
                if (typeof isSkippedFile !== 'boolean') {
                    // Inherit the parent's status
                    isSkippedFile = parentIsSkipped;
                }

                this._skipFileStatuses.set(s, isSkippedFile);

                if ((isSkippedFile && !inLibRange) || (!isSkippedFile && inLibRange)) {
                    const details = await this.sourceMapTransformer.allSourcePathDetails(mappedUrl.canonicalized);
                    const detail = details.find(d => parseResourceIdentifier(d.inferredPath).isEquivalent(s));
                    libPositions.push({
                        lineNumber: detail.startPosition.line,
                        columnNumber: detail.startPosition.column
                    });
                    inLibRange = !inLibRange;
                }
            }

            // If there's any change from the default, set proper blackboxed ranges
            if (libPositions.length || toggling) {
                if (parentIsSkipped) {
                    libPositions.splice(0, 0, { lineNumber: 0, columnNumber: 0 });
                }

                if (libPositions[0].lineNumber !== 0 || libPositions[0].columnNumber !== 0) {
                    // The list of blackboxed ranges must start with 0,0 for some reason.
                    // https://github.com/Microsoft/vscode-chrome-debug/issues/667
                    libPositions[0] = {
                        lineNumber: 0,
                        columnNumber: 0
                    };
                }

                await this.chrome.Debugger.setBlackboxedRanges(script, []).catch(() => this.warnNoSkipFiles());

                if (libPositions.length) {
                    this.chrome.Debugger.setBlackboxedRanges(script, libPositions).catch(() => this.warnNoSkipFiles());
                }
            }
        } else {
            const status = await this.getSkipStatus(mappedUrl);
            const skippedByPattern = this.matchesSkipFilesPatterns(mappedUrl);
            if (typeof status === 'boolean' && status !== skippedByPattern) {
                const positions = status ? [{ lineNumber: 0, columnNumber: 0 }] : [];
                this.chrome.Debugger.setBlackboxedRanges(script, positions).catch(() => this.warnNoSkipFiles());
            }
        }
    }

    private warnNoSkipFiles(): void {
        logger.log('Warning: this runtime does not support skipFiles');
    }

    private getScriptByUrl(url: IResourceIdentifier): IScript[] {
        return this._scriptsRegistry.getScriptsByPath(url);
    }

    private async onScriptParsed(scriptEvent: ScriptParsedEvent): Promise<void> {
        const script = scriptEvent.script;
        const sources = script.sourcesOfCompiled;
        await this.resolveSkipFiles(script, script.developmentSource.identifier, sources.map(source => source.identifier));
    }

    public install(_launchAttachArgs: ISkipFilesConfiguration): this {
        this._dependencies.onScriptParsed(scriptParsed => this.onScriptParsed(scriptParsed));
        this.configure(_launchAttachArgs);
        return this;
    }

    private configure(_launchAttachArgs: ISkipFilesConfiguration): SkipFilesLogic {
        let patterns: string[] = [];

        if (_launchAttachArgs.skipFiles) {
            const skipFilesArgs = _launchAttachArgs.skipFiles.filter(glob => {
                if (glob.startsWith('!')) {
                    logger.warn(`Warning: skipFiles entries starting with '!' aren't supported and will be ignored. ("${glob}")`);
                    return false;
                }

                return true;
            });

            patterns = skipFilesArgs.map(glob => utils.pathGlobToBlackboxedRegex(glob));
        }

        if (_launchAttachArgs.skipFileRegExps) {
            patterns = patterns.concat(_launchAttachArgs.skipFileRegExps);
        }

        if (patterns.length) {
            this._blackboxedRegexes = patterns.map(pattern => new RegExp(pattern, 'i'));
            this.refreshBlackboxPatterns();
        }

        return this;
    }

    constructor(
        private readonly _dependencies: EventsConsumedBySkipFilesLogic,
        @inject(TYPES.CDTPDiagnostics) private readonly chrome: CDTPDiagnostics,
        @inject(TYPES.DeleteMeScriptsRegistry) private readonly _scriptsRegistry: DeleteMeScriptsRegistry,
        @inject(TYPES.StackTracesLogic) private readonly stackTracesLogic: StackTracesLogic,
        @inject(TYPES.BaseSourceMapTransformer) private readonly sourceMapTransformer: BaseSourceMapTransformer,
        @inject(TYPES.BasePathTransformer) private readonly pathTransformer: BasePathTransformer,
    ) { }
}