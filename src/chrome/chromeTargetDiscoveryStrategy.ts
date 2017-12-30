/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {Logger} from 'vscode-debugadapter';
import * as utils from '../utils';
import * as telemetry from '../telemetry';

import * as chromeUtils from './chromeUtils';

import {ITargetDiscoveryStrategy, ITargetFilter, ITarget} from './chromeConnection';

import * as nls from 'vscode-nls';
const localize = nls.config(process.env.VSCODE_NLS_CONFIG)();

export class ChromeTargetDiscovery implements ITargetDiscoveryStrategy {
    private logger: Logger.ILogger;
    private telemetry: telemetry.ITelemetryReporter;

    constructor(_logger: Logger.ILogger, _telemetry: telemetry.ITelemetryReporter) {
        this.logger = _logger;
        this.telemetry = _telemetry;
    }

    async getTarget(address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<string> {
        const targets = await this.getAllTargets(address, port, targetFilter, targetUrl);
        if (targets.length > 1) {
            this.logger.log('Warning: Found more than one valid target page. Attaching to the first one. Available pages: ' + JSON.stringify(targets.map(target => target.url)));
        }

        const selectedTarget = targets[0];

        this.logger.verbose(`Attaching to target: ${JSON.stringify(selectedTarget)}`);
        this.logger.verbose(`WebSocket Url: ${selectedTarget.webSocketDebuggerUrl}`);

        return selectedTarget.webSocketDebuggerUrl;
    }

    async getAllTargets(address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<ITarget[]> {
        const targets = await this._getTargets(address, port);
        /* __GDPR__
           "targetCount" : {
              "numTargets" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
           }
         */
        this.telemetry.reportEvent('targetCount', { numTargets: targets.length });

        if (!targets.length) {
            return utils.errP(localize('attach.responseButNoTargets', "Got a response from the target app, but no target pages found"));
        }

        return this._getMatchingTargets(targets, targetFilter, targetUrl);
    };

    private _getTargets(address: string, port: number): Promise<ITarget[]> {
        // Temporary workaround till Edge fixes this bug: https://microsoft.visualstudio.com/OS/_workitems?id=15517727&fullScreen=false&_a=edit
        // Chrome and Node alias /json to /json/list so this should work too
        const url = `http://${address}:${port}/json/list`;
        this.logger.log(`Discovering targets via ${url}`);
        return utils.getURL(url).then<ITarget[]>(jsonResponse => {
            try {
                const responseArray = JSON.parse(jsonResponse);
                if (Array.isArray(responseArray)) {
                    return (responseArray as ITarget[])
                        .map(target => this._fixRemoteUrl(address, port, target));
                }
            } catch (e) {
                // JSON.parse can throw
            }

            return utils.errP(localize('attach.invalidResponse', "Response from the target seems invalid: {0}", jsonResponse));
        },
        e => {
            return utils.errP(localize('attach.cannotConnect', "Cannot connect to the target: {0}", e.message));
        });
    }

    private _getMatchingTargets(targets: ITarget[], targetFilter?: ITargetFilter, targetUrl?: string): ITarget[] {
        if (targetFilter) {
            // Apply the consumer-specific target filter
            targets = targets.filter(targetFilter);
        }

        // If a url was specified, try to filter to that url
        let filteredTargets = targetUrl ?
            chromeUtils.getMatchingTargets(targets, targetUrl) :
            targets;

        if (!filteredTargets.length) {
            throw new Error(localize('attach.noMatchingTarget', "Can't find a target that matches: {0}. Available pages: {1}", targetUrl, JSON.stringify(targets.map(target => target.url))));
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
            const addressMatch = target.webSocketDebuggerUrl.match(/ws:\/\/(.*:\d+)\/?/);
            if (addressMatch) {
                const replaceAddress = `${remoteAddress}:${remotePort}`;
                target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace(addressMatch[1], replaceAddress);
            }
        }

        return target;
    }
}
