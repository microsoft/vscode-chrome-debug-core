/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {Logger as logger} from 'vscode-debugadapter';
import * as utils from '../utils';
import * as telemetry from '../telemetry';

import * as chromeUtils from './chromeUtils';

import {ITargetDiscoveryStrategy, ITargetFilter, ITarget} from './chromeConnection';

export const getChromeTargetWebSocketURL: ITargetDiscoveryStrategy = (address: string, port: number, targetFilter?: ITargetFilter, targetUrl?: string): Promise<string> => {
    // Take the custom targetFilter, default to taking all targets
    targetFilter = targetFilter || (target => true);

    return _getTargets(address, port, targetFilter).then<string>(targets => {
        telemetry.reportEvent('targetCount', { numTargets: targets.length });
        if (!targets.length) {
            return utils.errP('Got a response from the target app, but no target pages found');
        }

        const target = _selectTarget(targets, targetUrl);
        logger.verbose(`Attaching to target: ${JSON.stringify(target)}`);

        const wsUrl = target.webSocketDebuggerUrl;
        logger.verbose(`WebSocket Url: ${wsUrl}`);

        return wsUrl;
    });
};

function _getTargets(address: string, port: number, targetFilter: ITargetFilter): Promise<ITarget[]> {
    const url = `http://${address}:${port}/json`;
    logger.log(`Discovering targets via ${url}`);
    return utils.getURL(url).then<ITarget[]>(jsonResponse => {
        try {
            const responseArray = JSON.parse(jsonResponse);
            if (Array.isArray(responseArray)) {
                return (responseArray as ITarget[])
                    .map(target => _fixRemoteUrl(address, target))
                    // Filter out some targets as specified by the extension
                    .filter(targetFilter);
            }
        } catch (e) {
            // JSON.parse can throw
        }

        return utils.errP(`Response from the target seems invalid: ${jsonResponse}`);
    },
    e => {
        return utils.errP('Cannot connect to the target: ' + e.message);
    });
}

function _selectTarget(targets: ITarget[], targetUrl?: string): ITarget {
    // If a url was specified, try to filter to that url
    let filteredTargets = targetUrl ?
        chromeUtils.getMatchingTargets(targets, targetUrl) :
        targets;

    if (!filteredTargets.length) {
        throw new Error(`Can't find a target that matches: ${targetUrl}. Available pages: ${JSON.stringify(targets.map(target => target.url))}`);
    }

    // If all possible targets appear to be attached to have some other devtool attached, then fail
    const targetsWithWSURLs = filteredTargets.filter(target => !!target.webSocketDebuggerUrl);
    if (!targetsWithWSURLs.length) {
        throw new Error(`Can't attach to this target that may have Chrome DevTools attached - ${filteredTargets[0].url}`);
    }

    filteredTargets = targetsWithWSURLs;
    if (filteredTargets.length > 1) {
        logger.log('Warning: Found more than one valid target page. Attaching to the first one. Available pages: ' + JSON.stringify(filteredTargets.map(target => target.url)));
    }

    return filteredTargets[0];
}

function _fixRemoteUrl(remoteAddress: string, target: ITarget): ITarget {
    if (target.webSocketDebuggerUrl) {
        const wsAddress = target.webSocketDebuggerUrl.split(':')[1];
        const replaceAddress = '//' + remoteAddress;
        if (wsAddress !== replaceAddress) {
            target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace(wsAddress, replaceAddress);
        }

        target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace('//127.0.0.1', replaceAddress);
        target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace('//localhost', replaceAddress);
    }

    return target;
}
