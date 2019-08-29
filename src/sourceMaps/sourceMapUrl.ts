/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { PossiblyCustomerContent, CustomerContent, NonCustomerContent } from '../chrome/logging/gdpr';
import { logger } from 'vscode-debugadapter';
import { SourceMapContents } from './sourceMapContents';

export class SourceMapUrl {
    private readonly _url: PossiblyCustomerContent<string>;
    public readonly isInlineSourceMap: boolean;

    private constructor(url: string) {
        this.isInlineSourceMap = url.indexOf('data:application/json') >= 0;
        this._url = this.isInlineSourceMap ? new CustomerContent(url) : new NonCustomerContent(url);
    }

    /** Create a source map url assuring that we are not creating an empty source map url */
    public static create<Null extends null | undefined>(url: string | Null, nullValue: Null): SourceMapUrl | Null {
        if (url) {
            return new SourceMapUrl(url);
        } else {
            return nullValue; // Convert '' to null or undefined
        }
    }

    public get customerContentData(): string {
        return this._url.customerContentData;
    }

    /**
     * Parses sourcemap contents from inlined base64-encoded data
     */
    public inlineSourceMapContents(): SourceMapContents | null {
        const firstCommaPos = this.customerContentData.indexOf(',');
        if (firstCommaPos < 0) {
            logger.log(`SourceMaps.getInlineSourceMapContents: Inline sourcemap is malformed.`);
            return null;
        }

        const header = this.customerContentData.substr(0, firstCommaPos);
        const data = this.customerContentData.substr(firstCommaPos + 1);

        try {
            if (header.indexOf(';base64') !== -1) {
                const buffer = new Buffer(data, 'base64');
                return new SourceMapContents(buffer.toString());
            } else {
                // URI encoded.
                return new SourceMapContents(decodeURI(data));
            }
        } catch (e) {
            logger.error(`SourceMaps.getInlineSourceMapContents: exception while processing data uri (${e.stack})`);
        }

        return null;
    }

    public toString(): string {
        return this._url.toString();
    }
}
