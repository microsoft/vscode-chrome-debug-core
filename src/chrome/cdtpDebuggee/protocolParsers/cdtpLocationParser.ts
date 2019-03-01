/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Position, LocationInScript } from '../../internal/locations/location';
import { createColumnNumber, createLineNumber } from '../../internal/locations/subtypes';
import { CDTPScriptsRegistry } from '../registries/cdtpScriptsRegistry';
import { Protocol as CDTP } from 'devtools-protocol';

interface IHasCoordinates {
    lineNumber: number;
    columnNumber?: number;
}

interface IHasScript {
    scriptId: CDTP.Runtime.ScriptId;
}

export interface IHasScriptLocation extends IHasCoordinates, IHasScript { }

export class CDTPLocationParser {
    constructor(private _scriptsRegistry: CDTPScriptsRegistry) { }

    public async getLocationInScript(crdpObjectWithScriptLocation: IHasScriptLocation): Promise<LocationInScript> {
        return new LocationInScript(await this._scriptsRegistry.getScriptByCdtpId(crdpObjectWithScriptLocation.scriptId),
            this.getCoordinates(crdpObjectWithScriptLocation));
    }

    private getCoordinates(crdpObjectWithCoordinates: IHasCoordinates): Position {
        return new Position(createLineNumber(crdpObjectWithCoordinates.lineNumber), createColumnNumber(crdpObjectWithCoordinates.columnNumber));
    }
}
