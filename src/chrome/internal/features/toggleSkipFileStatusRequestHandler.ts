import { ICommandHandlerDeclaration, CommandHandlerDeclaration, ICommandHandlerDeclarer } from './components';
import { SkipFilesLogic } from './skipFiles';
import { injectable, inject } from 'inversify';
import { ClientSourceParser } from '../../client/clientSourceParser';
import { HandlesRegistry } from '../../client/handlesRegistry';
import { IToggleSkipFileStatusArgs } from '../../../debugAdapterInterfaces';
import { SourceResolver } from '../sources/sourceResolver';

@injectable()
export class ToggleSkipFileStatusRequestHandler implements ICommandHandlerDeclarer {
    private readonly _clientSourceParser = new ClientSourceParser(this._handlesRegistry, this._sourcesLogic);

    public constructor(
        public readonly _skipFilesLogic: SkipFilesLogic,
        private readonly _handlesRegistry: HandlesRegistry,
        private readonly _sourcesLogic: SourceResolver) { }

    public getCommandHandlerDeclarations(): ICommandHandlerDeclaration[] {
        return CommandHandlerDeclaration.fromLiteralObject({
            toggleSkipFileStatus: (args: IToggleSkipFileStatusArgs) => this.toggleSkipFileStatus(args),
        });
    }

    private toggleSkipFileStatus(args: IToggleSkipFileStatusArgs): unknown {
        const source = this._clientSourceParser.toSource(args);
        return this._skipFilesLogic.toggleSkipFileStatus(source);
    }
}