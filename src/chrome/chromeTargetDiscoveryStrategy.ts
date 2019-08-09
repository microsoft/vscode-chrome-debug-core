/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as utils from '../utils';
import { IStepStartedEventsEmitter, StepProgressEventsEmitter, IObservableEvents, ExecutionTimingsReporter } from '../executionTimingsReporter';

import * as chromeUtils from './chromeUtils';

import { ITargetDiscoveryStrategy, ITargetFilter, ITarget } from './chromeConnection';

import * as nls from 'vscode-nls';
import { Version } from './utils/version';
import { ITelemetryReporter } from '../telemetry';
import { injectable, inject } from 'inversify';
import { TYPES } from './dependencyInjection.ts/types';
import { ILogger } from './internal/services/logging';
import { isNotEmpty, isDefined, hasMatches } from './utils/typedOperators';
import { LocalizedError, registerGetLocalize } from './utils/localization';
let localize = nls.loadMessageBundle();
registerGetLocalize(() => localize = nls.loadMessageBundle());

export class TargetVersions {
    constructor(public readonly protocol: Version, public readonly browser: Version) {}
}

@injectable()
export class ChromeTargetDiscovery implements ITargetDiscoveryStrategy, IObservableEvents<IStepStartedEventsEmitter> {
    public readonly events = new StepProgressEventsEmitter();

    public constructor(
        @inject(TYPES.ILogger) private logger: ILogger,
        @inject(TYPES.ITelemetryReporter) private readonly telemetry: ITelemetryReporter,
        @inject(TYPES.ExecutionTimingsReporter) reporter?: ExecutionTimingsReporter) { // The extension uses null here
            if (isDefined(reporter)) {
                reporter.subscribeTo(this.events);
            }
        }

    async getTarget(address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<ITarget> {
        const targets = await this.getAllTargets(address, port, targetFilter, targetUrl);
        if (targets.length > 1) {
            this.logger.log('Warning: Found more than one valid target page. Attaching to the first one. Available pages: ' + JSON.stringify(targets.map(target => target.url)));
        }

        const selectedTarget = targets[0];

        this.logger.log(`Attaching to target: ${JSON.stringify(selectedTarget)}`);
        this.logger.log(`WebSocket Url: ${selectedTarget.webSocketDebuggerUrl}`);

        return selectedTarget;
    }

    async getAllTargets(address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<ITarget[]> {
        const targets = await this._getTargets(address, port);
        /* __GDPR__
           "targetCount" : {
              "numTargets" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
              "${include}": [ "${DebugCommonProperties}" ]
           }
         */
        this.telemetry.reportEvent('targetCount', { numTargets: targets.length });

        if (targets.length === 0) {
            return utils.errP(localize('attach.responseButNoTargets', 'Got a response from the target app, but no target pages found'), 'attach.responseButNoTargets');
        }

        return this._getMatchingTargets(targets, targetFilter, targetUrl);
    }

    private async _getVersionData(address: string, port: number): Promise<TargetVersions> {

        const url = `http://${address}:${port}/json/version`;
        this.logger.log(`Getting browser and debug protocol version via ${url}`);

        const jsonResponse = await utils.getURL(url, { headers: { Host: 'localhost' } })
            .catch(e => {
                this.logger.log(`There was an error connecting to ${url} : ${e.message}`);
                return undefined;
            });

        try {
            if (isNotEmpty(jsonResponse)) {
                const response = JSON.parse(jsonResponse);
                const protocolVersionString = response['Protocol-Version'] as string;
                const browserWithPrefixVersionString = response.Browser as string;
                this.logger.log(`Got browser version: ${browserWithPrefixVersionString }`);
                this.logger.log(`Got debug protocol version: ${protocolVersionString}`);

                /* __GDPR__
                   "targetDebugProtocolVersion" : {
                       "debugProtocolVersion" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
                       "${include}": [ "${DebugCommonProperties}" ]
                   }
                 */

                const chromePrefix = 'Chrome/';
                let browserVersion = Version.unknownVersion();
                if (browserWithPrefixVersionString.startsWith(chromePrefix)) {
                    const browserVersionString = browserWithPrefixVersionString.substr(chromePrefix.length);
                    browserVersion = Version.coerce(browserVersionString);
                }

                this.telemetry.reportEvent('targetDebugProtocolVersion', { debugProtocolVersion: response['Protcol-Version'] });
                return new TargetVersions(Version.coerce(protocolVersionString), browserVersion);
            }
        } catch (e) {
            this.logger.log(`Didn't get a valid response for /json/version call. Error: ${e.message}. Response: ${jsonResponse}`);
        }
        return new TargetVersions(Version.unknownVersion(), Version.unknownVersion());
    }

    private async _getTargets(address: string, port: number): Promise<ITarget[]> {

        // Get the browser and the protocol version
        const version = this._getVersionData(address, port);

        /* __GDPR__FRAGMENT__
           "StepNames" : {
              "Attach.RequestDebuggerTargetsInformation" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
           }
         */
        this.events.emitStepStarted('Attach.RequestDebuggerTargetsInformation');

        const checkDiscoveryEndpoint = (url: string) => {
            this.logger.log(`Discovering targets via ${url}`);
            return utils.getURL(url, { headers: { Host: 'localhost' } });
        };

        const jsonResponse = await checkDiscoveryEndpoint(`http://${address}:${port}/json/list`)
            .catch(() => checkDiscoveryEndpoint(`http://${address}:${port}/json`))
            .catch(e => utils.errP(localize('attach.cannotConnect', 'Cannot connect to the target: {0}', e.message), 'attach.cannotConnect'));

        /* __GDPR__FRAGMENT__
           "StepNames" : {
              "Attach.ProcessDebuggerTargetsInformation" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
           }
         */
        this.events.emitStepStarted('Attach.ProcessDebuggerTargetsInformation');
        try {
            const responseArray = JSON.parse(jsonResponse);
            if (Array.isArray(responseArray)) {
                return (responseArray as ITarget[])
                    .map(target => {
                        this._fixRemoteUrl(address, port, target);
                        target.version = version;
                        return target;
                    });
            } else {
                return utils.errP(localize('attach.invalidResponseArray', 'Response from the target seems invalid: {0}', jsonResponse), 'attach.invalidResponseArray');
            }
        } catch (e) {
            return utils.errP(localize('attach.invalidResponse', 'Response from the target seems invalid. Error: {0}. Response: {1}', e.message, jsonResponse), 'attach.invalidResponse');
        }
    }

    private _getMatchingTargets(targets: ITarget[], targetFilter?: ITargetFilter, targetUrl?: string): ITarget[] {
        let filteredTargets = isDefined(targetFilter) ?
            targets.filter(targetFilter) : // Apply the consumer-specific target filter
            targets;

        // If a url was specified, try to filter to that url
        filteredTargets = isNotEmpty(targetUrl) ?
            chromeUtils.getMatchingTargets(filteredTargets, targetUrl) :
            filteredTargets;

        if (filteredTargets.length === 0) {
            throw new LocalizedError('attach.noMatchingTarget', localize('attach.noMatchingTarget', "Can't find a valid target that matches: {0}. Available pages: {1}", targetUrl, JSON.stringify(targets.map(target => target.url))));
        }

        // If all possible targets appear to be attached to have some other devtool attached, then fail
        const targetsWithWSURLs = filteredTargets.filter(target => isNotEmpty(target.webSocketDebuggerUrl));
        if (targetsWithWSURLs.length === 0) {
            throw new LocalizedError('attach.devToolsAttached', localize('attach.devToolsAttached', "Can't attach to this target that may have Chrome DevTools attached: {0}", filteredTargets[0].url));
        }

        return targetsWithWSURLs;
    }

    private _fixRemoteUrl(remoteAddress: string, remotePort: number, target: ITarget): ITarget {
        if (target.webSocketDebuggerUrl !== '') {
            const addressMatch = target.webSocketDebuggerUrl.match(/ws:\/\/([^/]+)\/?/);
            if (hasMatches(addressMatch)) {
                const replaceAddress = `${remoteAddress}:${remotePort}`;
                target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace(addressMatch[1], replaceAddress);
            }
        }

        return target;
    }
}
