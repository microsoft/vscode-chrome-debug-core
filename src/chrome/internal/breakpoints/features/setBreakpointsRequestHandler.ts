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
import { ConditionalPause, AlwaysPause, IBPActionWhenHit } from '../bpActionWhenHit';
import { ISource } from '../../sources/source';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { HandlesRegistry } from '../../../client/handlesRegistry';
import { LineColTransformer } from '../../../../transformers/lineNumberTransformer';
import { createLineNumber, createColumnNumber } from '../../locations/subtypes';
import { SourceResolver } from '../../sources/sourceResolver';

@injectable()
export class SetBreakpointsRequestHandler implements ICommandHandlerDeclarer {
    private readonly _clientSourceParser = new ClientSourceParser(this._handlesRegistry, this._sourcesResolver);
    private readonly _bpRecipieStatusToClientConverter = new BPRecipieStatusToClientConverter(this._handlesRegistry, this._lineColTransformer);

    public constructor(
        @inject(TYPES.IBreakpointsUpdater) protected readonly _breakpointsLogic: BreakpointsUpdater,
        private readonly _handlesRegistry: HandlesRegistry,
        @inject(TYPES.LineColTransformer) private readonly _lineColTransformer: LineColTransformer,
        private readonly _sourcesResolver: SourceResolver) { }

    public async setBreakpoints(args: DebugProtocol.SetBreakpointsArguments, telemetryPropertyCollector?: ITelemetryPropertyCollector): Promise<ISetBreakpointsResponseBody> {
        if (args.breakpoints) {
            const desiredBPRecipes = this.toBPRecipes(args);
            const bpRecipesStatus = await this._breakpointsLogic.updateBreakpointsForFile(desiredBPRecipes, telemetryPropertyCollector);
            return { breakpoints: await asyncMap(bpRecipesStatus, bprs => this._bpRecipieStatusToClientConverter.toBreakpoint(bprs)) };
        } else {
            throw new Error(`Expected the set breakpoints arguments to have a list of breakpoints yet it was ${args.breakpoints}`);
        }
    }

    private toBPRecipes(args: DebugProtocol.SetBreakpointsArguments): BPRecipesInSource {
        const source = this._clientSourceParser.toSource(args.source);
        const breakpoints = args.breakpoints.map(breakpoint => this.toBPRecipe(source, breakpoint));
        return new BPRecipesInSource(source, breakpoints);
    }

    private toBPRecipe(source: ISource, clientBreakpoint: DebugProtocol.SourceBreakpoint): BPRecipeInSource {
        return new BPRecipeInSource(
            new LocationInSource(source, this.toLocation(clientBreakpoint)),
            this.toBPActionWhenHit(clientBreakpoint));
    }

    private toBPActionWhenHit(actionWhenHit: { condition?: string; hitCondition?: string; logMessage?: string; }): IBPActionWhenHit {
        let howManyDefined = 0;
        howManyDefined += actionWhenHit.condition ? 1 : 0;
        howManyDefined += actionWhenHit.hitCondition ? 1 : 0;
        howManyDefined += actionWhenHit.logMessage ? 1 : 0;
        if (howManyDefined === 0) {
            return new AlwaysPause();
        } else if (howManyDefined === 1) {
            if (actionWhenHit.condition) {
                return new ConditionalPause(actionWhenHit.condition);
            } else if (actionWhenHit.hitCondition) {
                return new ConditionalPause(actionWhenHit.hitCondition);
            } else if (actionWhenHit.logMessage) {
                return new ConditionalPause(actionWhenHit.logMessage);
            } else {
                throw new Error(`Couldn't parse the desired action when hit for the breakpoint: 'condition' (${actionWhenHit.condition}), 'hitCondition' (${actionWhenHit.hitCondition}) or 'logMessage' (${actionWhenHit.logMessage})`);
            }
        } else { // howManyDefined >= 2
            throw new Error(`Expected a single one of 'condition' (${actionWhenHit.condition}), 'hitCondition' (${actionWhenHit.hitCondition}) and 'logMessage' (${actionWhenHit.logMessage}) to be defined, yet multiple were defined.`);
        }
    }

    private toLocation(location: { line: number; column?: number; }): Position {
        const lineNumber = createLineNumber(this._lineColTransformer.convertClientLineToDebugger(location.line));
        const columnNumber = location.column !== undefined ? createColumnNumber(this._lineColTransformer.convertClientColumnToDebugger(location.column)) : undefined;
        return new Position(lineNumber, columnNumber);
    }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            setBreakpoints: args => this.setBreakpoints(args)
        });
    }
}
