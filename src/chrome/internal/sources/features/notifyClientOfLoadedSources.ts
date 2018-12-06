import { IComponent } from '../../features/feature';
import { IScript } from '../../scripts/script';
import { ScriptParsedEvent } from '../../../target/events';
import { telemetry } from '../../../../telemetry';
import { SourceWasLoadedParameters, IEventsToClientReporter } from '../../../client/eventSender';
import { ValidatedMap } from '../../../collections/validatedMap';
import { CDTPScriptUrl } from '../resourceIdentifierSubtypes';
import { LoadedSourceEventReason, utils } from '../../../..';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';

export interface NotifyClientOfLoadedSourcesDependencies {
    sendSourceWasLoaded(params: SourceWasLoadedParameters): Promise<void>;
    onScriptParsed(listener: (scriptEvent: ScriptParsedEvent) => Promise<void>): void;
}

@injectable()
export class NotifyClientOfLoadedSources implements IComponent {
    // TODO DIEGO: Ask VS what index do they use internally to verify if the source is the same or a new one
    private _notifiedSourceByUrl = new ValidatedMap<CDTPScriptUrl, IScript>();

    public install(): this {
        this._dependencies.onScriptParsed(async scriptParsed => this.sendLoadedSourceEvent(scriptParsed.script, 'new'));
        return this;
    }

    /**
     * e.g. the target navigated
     */
    protected onExecutionContextsCleared(): void {
        for (const script of this._notifiedSourceByUrl.values()) {
            this.sendLoadedSourceEvent(script, 'removed');
        }
    }

    protected async sendLoadedSourceEvent(script: IScript, loadedSourceEventReason: LoadedSourceEventReason): Promise<void> {
        switch (loadedSourceEventReason) {
            case 'new':
            case 'changed':
                if (script.executionContext.isDestroyed()) {
                    return; // We processed the events out of order, and this event got here after we destroyed the context. ignore it.
                }

                if (this._notifiedSourceByUrl.get(script.url)) {
                    const exists = await utils.existsAsync(script.developmentSource.identifier.canonicalized);
                    if (exists) {
                        // We only need to send changed events for dynamic scripts. The client tracks files on storage on it's own, so this notification is not needed
                        loadedSourceEventReason = 'changed';
                    } else {
                        return; // VS is strict about the changed notifications, and it will fail if we send a changed notification for a file on storage, so we omit it on purpose
                    }
                } else {
                    loadedSourceEventReason = 'new';
                }
                this._notifiedSourceByUrl.set(script.url, script);
                break;
            case 'removed':
                if (!this._notifiedSourceByUrl.delete(script.url)) {
                    telemetry.reportEvent('LoadedSourceEventError', { issue: 'Tried to remove non-existent script', scriptId: script });
                    return;
                }
                break;
            default:
                telemetry.reportEvent('LoadedSourceEventError', { issue: 'Unknown reason', reason: loadedSourceEventReason });
        }

        // TODO DIEGO: Should we be using the source tree here?
        // const sourceTree = this._sourcesLogic.getLoadedSourcesTree(script.script);

        this._eventsToClientReporter.sendSourceWasLoaded({ reason: loadedSourceEventReason, source: script.developmentSource });
    }

    constructor(private readonly _dependencies: NotifyClientOfLoadedSourcesDependencies,
        @inject(TYPES.EventSender) private readonly _eventsToClientReporter: IEventsToClientReporter) { }
}