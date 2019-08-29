/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { PossiblyCustomerContent, CustomerContent } from '../chrome/logging/gdpr';
import { RawSourceMap } from 'source-map';

export class SourceMapContents {
    private readonly _data: PossiblyCustomerContent<string>;

    public constructor(data: string) {
        this._data = new CustomerContent(data);
    }

    public parsed(): RawSourceMap {
        const sourceMap: RawSourceMap = JSON.parse(this._data.customerContentData); // The only customer data propery is the sourcesContent property
        delete sourceMap.sourcesContent; // We don't use sourcesContent. We delete it so that sourcesContent won't have any more customer data and it'll be safe to log, etc...
        return sourceMap;
    }

    public toString(): string {
        return this._data.toString();
    }
}
