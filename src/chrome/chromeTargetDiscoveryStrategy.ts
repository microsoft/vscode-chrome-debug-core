/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Logger } from 'vscode-debugadapter';
import * as utils from '../utils';
import * as telemetry from '../telemetry';
import { IStepStartedEventsEmitter, StepProgressEventsEmitter, IObservableEvents } from '../executionTimingsReporter';

import * as chromeUtils from './chromeUtils';

import { ITargetDiscoveryStrategy, ITargetFilter, ITarget } from './chromeConnection';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

export class Version {
    static parse(versionString: string): Version {
        const majorAndMinor = versionString.split('.');
        const major = parseInt(majorAndMinor[0], 10);
        const minor = parseInt(majorAndMinor[1], 10);
        return new Version(major, minor);
    }

    public static unknownVersion(): Version {
        return new Version(0, 0); // Using 0.0 will make behave isAtLeastVersion as if this was the oldest possible version
    }

    constructor(private _major: number, private _minor: number) {}

    public isAtLeastVersion(major: number, minor: number): boolean {
        return this._major > major || (this._major === major && this._minor >= minor);
    }
}

export class TargetVersions {
    constructor(public readonly protocol: Version, public readonly browser: Version) {}
}

export class ChromeTargetDiscovery implements ITargetDiscoveryStrategy, IObservableEvents<IStepStartedEventsEmitter> {
    private logger: Logger.ILogger;
    private telemetry: telemetry.ITelemetryReporter;
    public readonly events = new StepProgressEventsEmitter();

    constructor(_logger: Logger.ILogger, _telemetry: telemetry.ITelemetryReporter) {
        this.logger = _logger;
        this.telemetry = _telemetry;
    }

    async getTarget(address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<ITarget> {
        const targets = await this.getAllTargets(address, port, targetFilter, targetUrl);
        if (targets.length > 1) {
            this.logger.log('Warning: Found more than one valid target page. Attaching to the first one. Available pages: ' + JSON.stringify(targets.map(target => target.url)));
        }

        const selectedTarget = targets[0];

        this.logger.verbose(`Attaching to target: ${JSON.stringify(selectedTarget)}`);
        this.logger.verbose(`WebSocket Url: ${selectedTarget.webSocketDebuggerUrl}`);

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

        if (!targets.length) {
            return utils.errP(localize('attach.responseButNoTargets', 'Got a response from the target app, but no target pages found'));
        }

        return this._getMatchingTargets(targets, targetFilter, targetUrl);
    }

    private async _getVersionData(address: string, port: number): Promise<TargetVersions> {

        const url = `http://${address}:${port}/json/version`;
        this.logger.log(`Getting browser and debug protocol version via ${url}`);

        const jsonResponse = await utils.getURL(url, { headers: { Host: 'localhost' } })
            .catch(e => this.logger.log(`There was an error connecting to ${url} : ${e.message}`));

        try {
            if (jsonResponse) {
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
                    browserVersion = Version.parse(browserVersionString);
                }

                this.telemetry.reportEvent('targetDebugProtocolVersion', { debugProtocolVersion: response['Protcol-Version'] });
                return new TargetVersions(Version.parse(protocolVersionString), browserVersion);
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
            .catch(e => utils.errP(localize('attach.cannotConnect', 'Cannot connect to the target: {0}', e.message)));

        /* __GDPR__FRAGMENT__
           "StepNames" : {
              "Attach.ProcessDebuggerTargetsInformation" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
           }
         */
        this.events.emitStepStarted('Attach.ProcessDebuggerTargetsInformation');
        let responseArray: any;

        try {
            responseArray = JSON.parse(jsonResponse);
        } catch (e) {
            try {
                // If it fails to parse, this is possibly https://github.com/electron/electron/issues/11524.
                // Workaround, just snip out the title property and try again.
                // Since we don't know exactly which characters might break JSON.parse or why, we can't give a more targeted fix.
                responseArray = JSON.parse(removeTitleProperty(jsonResponse));
            } catch (e) {
                return utils.errP(localize('attach.invalidResponse', 'Response from the target seems invalid. Error: {0}. Response: {1}', e.message, jsonResponse));
            }
        }

        if (Array.isArray(responseArray)) {
            return (responseArray as ITarget[])
                .map(target => {
                    this._fixRemoteUrl(address, port, target);
                    target.version = version;
                    return target;
                });
        } else {
            return utils.errP(localize('attach.invalidResponseArray', 'Response from the target seems invalid: {0}', jsonResponse));
        }
    }

    private _getMatchingTargets(targets: ITarget[], targetFilter?: ITargetFilter, targetUrl?: string): ITarget[] {
        let filteredTargets = targetFilter ?
            targets.filter(targetFilter) : // Apply the consumer-specific target filter
            targets;

        // If a url was specified, try to filter to that url
        filteredTargets = targetUrl ?
            chromeUtils.getMatchingTargets(filteredTargets, targetUrl) :
            filteredTargets;

        if (!filteredTargets.length) {
            throw new Error(localize('attach.noMatchingTarget', "Can't find a valid target that matches: {0}. Available pages: {1}", targetUrl, JSON.stringify(targets.map(target => target.url))));
        }

        // If all possible targets appear to be attached to have some other devtool attached, then fail
        const targetsWithWSURLs = filteredTargets.filter(target => !!target.webSocketDebuggerUrl);
        if (!targetsWithWSURLs.length) {
            throw new Error(localize('attach.devToolsAttached', "Can't attach to this target that may have Chrome DevTools attached: {0}", filteredTargets[0].url));
        }

        return targetsWithWSURLs;
    }

    private _fixRemoteUrl(remoteAddress: string, remotePort: number, target: ITarget): ITarget {
        if (target.webSocketDebuggerUrl) {
            const addressMatch = target.webSocketDebuggerUrl.match(/ws:\/\/([^/]+)\/?/);
            if (addressMatch) {
                const replaceAddress = `${remoteAddress}:${remotePort}`;
                target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace(addressMatch[1], replaceAddress);
            }
        }

        return target;
    }
}

export function removeTitleProperty(targetsResponse: string): string {
    return targetsResponse.replace(/"title": "[^"]+",?/, '');
}