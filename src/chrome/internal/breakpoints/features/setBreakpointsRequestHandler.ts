/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { injectable, inject } from 'inversify';
import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from '../../features/components';
import { DebugProtocol } from 'vscode-debugprotocol';
import { BreakpointsUpdater } from './breakpointsUpdater';
import { ISetBreakpointsResponseBody, ITelemetryPropertyCollector } from '../../../../debugAdapterInterfaces';
import { BPRecipesInSource } from '../bpRecipes';
import { asyncMap } from '../../../collections/async';
import { ClientSourceParser } from '../../../client/clientSourceParser';
import { BPRecipieStatusToClientConverter } from './bpRecipieStatusToClientConverter';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { LocationInSource, Position } from '../../locations/location';
import { ConditionalPause, AlwaysPause, IBPActionWhenHit, PauseOnHitCount } from '../bpActionWhenHit';
import { ISource } from '../../sources/source';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { HandlesRegistry } from '../../../client/handlesRegistry';
import { LineColTransformer } from '../../../../transformers/lineNumberTransformer';
import { createLineNumber, createColumnNumber } from '../../locations/subtypes';
import { SourceResolver } from '../../sources/sourceResolver';
import { logger } from 'vscode-debugadapter';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { BPRecipeStatusChanged } from '../registries/bpRecipeStatusCalculator';
import { isDefined, isNotEmpty } from '../../../utils/typedOperators';
import { ISourceToClientConverter } from '../../../client/sourceToClientConverter';
import { InternalError } from '../../../utils/internalError';
import { LocalizedError } from '../../../utils/localizedError';

@injectable()
export class SetBreakpointsRequestHandler implements ICommandHandlerDeclarer {
    private _inFlightRequests = Promise.resolve<unknown>(null);

    private readonly _clientSourceParser = new ClientSourceParser(this._handlesRegistry, this._sourcesResolver);
    private readonly _bpRecipieStatusToClientConverter = new BPRecipieStatusToClientConverter(this._handlesRegistry, this._sourceToClientConverter, this._lineColTransformer);

    public constructor(
        @inject(TYPES.IBreakpointsUpdater) protected readonly _breakpointsLogic: BreakpointsUpdater,
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.LineColTransformer) private readonly _lineColTransformer: LineColTransformer,
        @inject(TYPES.SourceToClientConverter) private readonly _sourceToClientConverter: ISourceToClientConverter,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter,
        private readonly _sourcesResolver: SourceResolver) {
        this._breakpointsLogic.bpRecipeStatusChangedListeners.add(status => this.onBPRecipeStatusChanged(status));
    }

    public async setBreakpoints(args: DebugProtocol.SetBreakpointsArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector): Promise<ISetBreakpointsResponseBody> {
        if (isDefined(args.breakpoints)) {
            const desiredBPRecipes = this.toBPRecipes(args);
            const bpRecipesStatus = await this._breakpointsLogic.updateBreakpointsForFile(desiredBPRecipes, telemetryPropertyCollector);
            const response = { breakpoints: await asyncMap(bpRecipesStatus, bprs => this._bpRecipieStatusToClientConverter.toBreakpoint(bprs)) };
            if (response.breakpoints.length !== args.breakpoints.length) {
                throw new InternalError('error.setBreakpoints.expectedResponseToMatchRequestLength', `The response the debug adapter generated for setBreakpoints have ${args.breakpoints.length} breakpoints in the response yet {1} breakpoints were set. Response: ${JSON.stringify(response.breakpoints)}, response.breakpoints.length`);
            }

            return response;
        } else {
            throw new InternalError('error.setBreakpoints.argumentNotDefined', `Expected the set breakpoints arguments to have a list of breakpoints yet it was ${args.breakpoints}`);
        }
    }

    private toBPRecipes(args: DebugProtocol.SetBreakpointsArguments): BPRecipesInSource {
        const source = this._clientSourceParser.toSource(args.source);
        const breakpoints = args.breakpoints!.map(breakpoint => this.toBPRecipe(source, breakpoint));
        return new BPRecipesInSource(source, breakpoints);
    }

    private toBPRecipe(source: ISource, clientBreakpoint: DebugProtocol.SourceBreakpoint): BPRecipeInSource {
        return new BPRecipeInSource(
            new LocationInSource(source, this.toLocation(clientBreakpoint)),
            this.toBPActionWhenHit(clientBreakpoint));
    }

    private toBPActionWhenHit(actionWhenHit: { condition?: string; hitCondition?: string; logMessage?: string; }): IBPActionWhenHit {
        let howManyDefined = 0;
        howManyDefined += isNotEmpty(actionWhenHit.condition) ? 1 : 0;
        howManyDefined += isNotEmpty(actionWhenHit.hitCondition) ? 1 : 0;
        howManyDefined += isNotEmpty(actionWhenHit.logMessage) ? 1 : 0;
        if (howManyDefined === 0) {
            return new AlwaysPause();
        } else if (howManyDefined === 1) {
            if (isNotEmpty(actionWhenHit.condition)) {
                return new ConditionalPause(actionWhenHit.condition);
            } else if (isNotEmpty(actionWhenHit.hitCondition)) {
                return new PauseOnHitCount(actionWhenHit.hitCondition);
            } else if (isNotEmpty(actionWhenHit.logMessage)) {
                return new ConditionalPause(actionWhenHit.logMessage);
            } else {
                throw new InternalError('error.setBreakpoints.failedToParseActionWhenHit',
                    `Couldn't parse the requested action when hit for the breakpoint: 'condition' (${actionWhenHit.condition}),`
                    + ` 'hitCondition' (${actionWhenHit.hitCondition}) or 'logMessage' (${actionWhenHit.logMessage})`);
            }
        } else { // howManyDefined >= 2
            throw new LocalizedError(localize('error.setBreakpoints.cantHaveTwoActions', "Expected a single one of 'condition' ({0}), 'hitCondition' ({1}) and 'logMessage' ({2}) to be defined, yet multiple were defined.", actionWhenHit.condition, actionWhenHit.hitCondition, actionWhenHit.logMessage));
        }
    }

    private toLocation(location: { line: number; column?: number; }): Position {
        const lineNumber = createLineNumber(this._lineColTransformer.convertClientLineToDebugger(location.line));
        const columnNumber = location.column !== undefined
            ? createColumnNumber(this._lineColTransformer.convertClientColumnToDebugger(location.column))
            : createColumnNumber(0); // If no column number is specified, we default to assuming the column number is zero
        return new Position(lineNumber, columnNumber);
    }

    public async getCommandHandlerDeclarations(): Promise<ICommandHandlerDeclaration[]> {
        await this._breakpointsLogic.install();
        return CommandHandlerDeclaration.fromLiteralObject({
            setBreakpoints: args => {
                const response = this.setBreakpoints(args);
                const waitForResponseIgnoringFailures = response.then(() => {}, () => {});
                /**
                 * The breakpoints gets assigned at the end of the setBreakpoints request
                 * We need to prevent BPStatusChanged from being sent while we are processing a setBreakpoints request event, because they might
                 * try to reference a breakpoint for which the client doesn't yet have an id
                 */
                this._inFlightRequests = Promise.all([this._inFlightRequests, waitForResponseIgnoringFailures]); // inFlightRequests ignores failures on requests
                return response; // The setBreakpoints failures will ve handled by our caller
            }
        });
    }

    protected async onBPRecipeStatusChanged(statusChanged: BPRecipeStatusChanged): Promise<void> {
        /**
         * The breakpoints gets assigned at the end of the setBreakpoints request
         * We need to prevent BPStatusChanged from being sent while we are processing a setBreakpoints request event, because they might
         * try to reference a breakpoint for which the client doesn't yet have an id
         */
        logger.log(`Waiting for set breakpoints on flight requests`);

        this._inFlightRequests.then(() => this._eventsToClientReporter.sendBPStatusChanged({ reason: 'changed', bpRecipeStatus: statusChanged.status }), rejection => {
            logger.error(`Failed to send a breakpoint status update: ${rejection}`);
        });
    }
}
