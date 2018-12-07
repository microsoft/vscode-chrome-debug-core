import { BasePathTransformer } from '../../../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../../../transformers/baseSourceMapTransformer';
import { IScript } from '../scripts/script';
import { ICallFrame } from '../stackTraces/callFrame';
import { PausedEvent } from '../../target/events';
import { InformationAboutPausedProvider } from './takeProperActionOnPausedEvent';
import { logger } from 'vscode-debugadapter';
import { IComponent, ComponentConfiguration } from './feature';
import { LocationInLoadedSource } from '../locations/location';
import { ICallFramePresentationDetails } from '../stackTraces/callFramePresentation';
import { Abstained, VoteRelevance, VoteCommonLogic, Vote } from '../../communication/collaborativeDecision';
import * as nls from 'vscode-nls';
import { injectable, inject } from 'inversify';
import { IStackTracePresentationLogicProvider } from '../stackTraces/stackTracesLogic';
import { TYPES } from '../../dependencyInjection.ts/types';
const localize = nls.loadMessageBundle();

export interface EventsConsumedBySmartStepLogic {
    subscriberForAskForInformationAboutPaused(listener: InformationAboutPausedProvider): void;
}

export interface SmartStepLogicConfiguration {
    isEnabled: boolean;
}

export interface ShouldStepInToAvoidSkippedSourceDependencies {
    stepIntoDebugee(): Promise<void>;
}
export class ShouldStepInToAvoidSkippedSource extends VoteCommonLogic<void> {
    public readonly relevance = VoteRelevance.OverrideOtherVotes;

    private readonly _dependencies: ShouldStepInToAvoidSkippedSourceDependencies;

    public async execute(): Promise<void> {
        return this._dependencies.stepIntoDebugee();
    }
}

@injectable()
export class SmartStepLogic implements IComponent, IStackTracePresentationLogicProvider {
    private _smartStepCount = 0;
    private _isEnabled = false;

    public isEnabled(): boolean {
        return this._isEnabled;
    }

    public toggleEnabled(): void {
        this.enable(!this._isEnabled);
    }

    public enable(shouldEnable: boolean): void {
        this._isEnabled = shouldEnable;
    }

    public async toggleSmartStep(): Promise<void> {
        this.toggleEnabled();
        this.stepInIfOnSkippedSource();
    }

    public async askForInformationAboutPaused(paused: PausedEvent): Promise<Vote<void>> {
        if (this.isEnabled() && await this.shouldSkip(paused.callFrames[0])) {
            this._smartStepCount++;
            return new ShouldStepInToAvoidSkippedSource();
        } else {
            if (this._smartStepCount > 0) {
                logger.log(`SmartStep: Skipped ${this._smartStepCount} steps`);
                this._smartStepCount = 0;
            }
            return new Abstained();
        }
    }

    public stepInIfOnSkippedSource(): void {
        throw new Error('Not implemented TODO DIEGO');
    }

    public async shouldSkip(frame: ICallFrame<IScript>): Promise<boolean> {
        if (!this._isEnabled) return false;

        const clientPath = this._pathTransformer.getClientPathFromTargetPath(frame.location.script.runtimeSource.identifier)
            || frame.location.script.runtimeSource.identifier;
        const mapping = await this._sourceMapTransformer.mapToAuthored(clientPath.canonicalized, frame.codeFlow.location.lineNumber, frame.codeFlow.location.columnNumber);
        if (mapping) {
            return false;
        }

        if ((await this._sourceMapTransformer.allSources(clientPath.canonicalized)).length) {
            return true;
        }

        return false;
    }

    public getCallFrameAdditionalDetails(locationInLoadedSource: LocationInLoadedSource): ICallFramePresentationDetails[] {
        return this.isEnabled && !locationInLoadedSource.source.isSourceOfCompiled()
            ? [{
                additionalSourceOrigins: [localize('smartStepFeatureName', 'smartStep')],
                sourcePresentationHint: 'deemphasize'
            }]
            : [];
    }

    public install(configuration: ComponentConfiguration): this {
        this._dependencies.subscriberForAskForInformationAboutPaused(paused => this.askForInformationAboutPaused(paused));
        this.configure(configuration);
        return this;
    }

    public configure(configuration: ComponentConfiguration): void {
        this._isEnabled = !!configuration.args.smartStep;
    }

    constructor(
        @inject(TYPES.EventsConsumedByConnectedCDA) private readonly _dependencies: EventsConsumedBySmartStepLogic,
        @inject(TYPES.BasePathTransformer) private readonly _pathTransformer: BasePathTransformer,
        @inject(TYPES.BaseSourceMapTransformer) private readonly _sourceMapTransformer: BaseSourceMapTransformer
    ) {
    }
}