import { ILoadedSource } from './loadedSource';
import { ValidatedMap } from '../../collections/validatedMap';
import { printIterable } from '../../collections/printting';
import { IComponent } from '../features/feature';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../dependencyInjection.ts/types';
import { IScriptSources } from '../../target/cdtpDebugger';

@injectable()
export class SourceTextLogic implements IComponent {
    private _sourceToText = new ValidatedMap<ILoadedSource, string>();

    public async text(loadedSource: ILoadedSource): Promise<string> {
        let text = this._sourceToText.tryGetting(loadedSource);

        if (text !== null) {
            text = await this._scriptSources.getScriptSource(loadedSource.script);
            this._sourceToText.set(loadedSource, text);
        }

        return text;
    }

    public toString(): string {
        return `Sources text logic\n${printIterable('sources in cache', this._sourceToText.keys())}`;
    }

    public install(): this {
        return this;
    }

    constructor(@inject(TYPES.IScriptSources) private readonly _scriptSources: IScriptSources) { }
}