import { Coordinates, LocationInScript } from '../internal/locations/location';
import { LineNumber, ColumnNumber } from '../internal/locations/subtypes';
import { CDTPScriptsRegistry } from './cdtpScriptsRegistry';
import { Crdp } from '../..';
import { injectable } from 'inversify';

interface HasLocation {
    lineNumber: number;
    columnNumber?: number;
}

interface HasScript {
    scriptId: Crdp.Runtime.ScriptId;
}

export interface HasScriptLocation extends HasLocation, HasScript { }

@injectable()
export class CDTPLocationParser {
    public async getScriptLocation(crdpScriptLocation: HasScriptLocation): Promise<LocationInScript> {
        return new LocationInScript(await this._scriptsRegistry.getScriptById(crdpScriptLocation.scriptId),
            this.getLocation(crdpScriptLocation));
    }

    private getLocation(crdpLocation: HasLocation): Coordinates {
        return new Coordinates(crdpLocation.lineNumber as LineNumber, crdpLocation.columnNumber as ColumnNumber);
    }

    constructor(
        private readonly _scriptsRegistry: CDTPScriptsRegistry) { }
}
