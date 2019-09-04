/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { BasePathTransformer } from '../../../transformers/basePathTransformer';
import { BaseSourceMapTransformer } from '../../../transformers/baseSourceMapTransformer';
import { ScriptCallFrame, CallFrameWithState } from '../stackTraces/callFrame';
import { PausedEvent } from '../../cdtpDebuggee/eventsProviders/cdtpDebuggeeExecutionEventsProvider';
import { IActionToTakeWhenPaused, NoActionIsNeededForThisPause, BaseActionToTakeWhenPaused } from '../features/actionToTakeWhenPaused';
import { logger } from 'vscode-debugadapter';
import { LocationInLoadedSource } from '../locations/location';
import { ICallFramePresentationDetails } from '../stackTraces/callFramePresentation';
import * as nls from 'vscode-nls';
import { injectable, inject } from 'inversify';
import { IStackTracePresentationDetailsProvider } from '../stackTraces/stackTracePresenter';
import { TYPES } from '../../dependencyInjection.ts/types';
import { ConnectedCDAConfiguration } from '../../client/chromeDebugAdapter/cdaConfiguration';
import * as utils from '../../../utils';
import { IDebuggeePausedHandler } from './debuggeePausedHandler';
import { IDebuggeeSteppingController } from '../../cdtpDebuggee/features/cdtpDebugeeSteppingController';
import { printClassDescription } from '../../utils/printing';
import * as _ from 'lodash';
import { isNotNull } from '../../utils/typedOperators';
import { DoNotLog } from '../../logging/decorators';
import { registerGetLocalize } from '../../utils/localization';
let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

export interface ISmartStepLogicConfiguration {
    isEnabled: boolean;
}

@printClassDescription
export class ShouldStepInToAvoidSkippedSource extends BaseActionToTakeWhenPaused {
    public constructor(private readonly _debuggeeSteppingController: IDebuggeeSteppingController) {
        super();
    }

    public async execute(): Promise<void> {
        return this._debuggeeSteppingController.stepInto({ breakOnAsyncCall: true });
    }

    public isAutoResuming(): boolean {
        return false;
    }
}

@injectable()
export class SmartStepLogic implements IStackTracePresentationDetailsProvider {
    private _smartStepCount = 0;
    private _isEnabled = false;

    constructor(
        @inject(TYPES.IDebuggeePausedHandler) private readonly _debuggeePausedHandler: IDebuggeePausedHandler,
        @inject(TYPES.BasePathTransformer) private readonly _pathTransformer: BasePathTransformer,
        @inject(TYPES.BaseSourceMapTransformer) private readonly _sourceMapTransformer: BaseSourceMapTransformer,
        @inject(TYPES.ConnectedCDAConfiguration) private readonly _configuration: ConnectedCDAConfiguration,
        @inject(TYPES.IDebuggeeSteppingController) private readonly _debuggeeSteppingController: IDebuggeeSteppingController
    ) {
        this._debuggeePausedHandler.registerActionProvider(paused => this.onProvideActionForWhenPaused(paused));
        this.configure();
    }

    @DoNotLog()
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
        await this.stepInIfOnSkippedSource();
    }

    @DoNotLog()
    public async onProvideActionForWhenPaused(paused: PausedEvent): Promise<IActionToTakeWhenPaused> {
        if (this.isEnabled() && await this.shouldSkip(paused.callFrames[0])) {
            this._smartStepCount++;
            return new ShouldStepInToAvoidSkippedSource(this._debuggeeSteppingController);
        } else {
            if (this._smartStepCount > 0) {
                logger.log(`SmartStep: Skipped ${this._smartStepCount} steps`);
                this._smartStepCount = 0;
            }
            return new NoActionIsNeededForThisPause(this);
        }
    }

    public async stepInIfOnSkippedSource(): Promise<void> {
        // Reprocess the latest pause event to adjust for any changes in our configuration
        await this._debuggeePausedHandler.reprocessLatestPause();
    }

    public async shouldSkip(frame: ScriptCallFrame<CallFrameWithState>): Promise<boolean> {
        if (!this._isEnabled) return false;

        const clientPath = _.defaultTo(this._pathTransformer.getClientPathFromTargetPath(frame.location.script.runtimeSource.identifier),
            frame.location.script.runtimeSource.identifier);
        const mapping = await this._sourceMapTransformer.mapToAuthored(clientPath.canonicalized, frame.codeFlow.lineNumber, frame.codeFlow.columnNumber);
        if (isNotNull(mapping)) {
            return false;
        }

        if ((await this._sourceMapTransformer.allSources(clientPath.canonicalized)).length > 0) {
            return true;
        }

        return false;
    }

    @DoNotLog()
    public callFrameAdditionalDetails(locationInLoadedSource: LocationInLoadedSource): ICallFramePresentationDetails[] {
        return this.isEnabled() && !locationInLoadedSource.source.isMappedSource()
            ? [{
                additionalSourceOrigins: [localize('smartStepFeatureName', 'smartStep')],
                sourcePresentationHint: 'deemphasize'
            }]
            : [];
    }

    public configure(): void {
        this._isEnabled = !!utils.defaultIfUndefined(this._configuration.args.smartStep, this._configuration.isVSClient);
    }

    public toString(): string {
        return 'SmartStep';
    }
}