/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { telemetry } from '../../../../telemetry';
import { IEventsToClientReporter } from '../../../client/eventsToClientReporter';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../dependencyInjection.ts/types';
import { IScriptParsedEvent, IScriptParsedProvider } from '../../../cdtpDebuggee/eventsProviders/cdtpOnScriptParsedEventProvider';
import { ILoadedSource, ContentsLocation } from '../loadedSource';
import { newResourceIdentifierMap } from '../resourceIdentifier';
import { LoadedSourceEventReason } from '../../../chromeDebugAdapter';

/**
 * This class will keep the client updated of the sources that are associated with the scripts that are currently loaded in the debuggee
 */
@injectable()
export class NotifyClientOfLoadedSources {
    // TODO DIEGO: Ask VS what index do they use internally to verify if the source is the same or a new one
    private _notifiedSourceByIdentifier = newResourceIdentifierMap<ILoadedSource>();

    constructor(
        @inject(TYPES.IScriptParsedProvider) public readonly _cdtpOnScriptParsedEventProvider: IScriptParsedProvider,
        @inject(TYPES.IEventsToClientReporter) private readonly _eventsToClientReporter: IEventsToClientReporter) {
        this._cdtpOnScriptParsedEventProvider.onScriptParsed(scriptParsed => this.onScriptParsed(scriptParsed));
    }

    public async onScriptParsed(scriptParsed: IScriptParsedEvent): Promise<void> {
        // We processed the events out of order. If this event got here after we destroyed the context then ignore it.
        if (!scriptParsed.script.executionContext.isDestroyed()) {
            scriptParsed.script.allSources.forEach(source => this.sendLoadedSourceEvent(source, 'new'));
        }
    }

    /**
     * e.g. the target navigated
     */
    protected async onExecutionContextsCleared() {
        let sourceEvents = [];
        for (const script of this._notifiedSourceByIdentifier.values()) {
            sourceEvents.push(this.sendLoadedSourceEvent(script, 'removed'));
        }
        return Promise.all(sourceEvents);
    }

    protected async sendLoadedSourceEvent(source: ILoadedSource, loadedSourceEventReason: LoadedSourceEventReason) {
        switch (loadedSourceEventReason) {
            case 'new':
            case 'changed':
                if (this._notifiedSourceByIdentifier.tryGetting(source.identifier) !== undefined) {
                    if (source.contentsLocation === ContentsLocation.PersistentStorage) {
                        // We only need to send changed events for dynamic scripts. The client tracks files on storage on it's own, so this notification is not needed
                        loadedSourceEventReason = 'changed';
                    } else {
                        return; // VS is strict about the changed notifications, and it will fail if we send a changed notification for a file on storage, so we omit it on purpose
                    }
                } else {
                    loadedSourceEventReason = 'new';
                    this._notifiedSourceByIdentifier.set(source.identifier, source);
                }
                break;
            case 'removed':
                if (!this._notifiedSourceByIdentifier.delete(source.identifier)) {
                    telemetry.reportEvent('LoadedSourceEventError', { issue: 'Tried to remove non-existent loaded source' });
                    return;
                }
                break;
            default:
                telemetry.reportEvent('LoadedSourceEventError', { issue: 'Unknown reason', reason: loadedSourceEventReason });
        }

        await this._eventsToClientReporter.sendSourceWasLoaded({ reason: loadedSourceEventReason, source: source });
    }
}