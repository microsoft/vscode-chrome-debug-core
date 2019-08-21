/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { PossiblyCustomerContent, CustomerContent, NonCustomerContent } from '../chrome/logging/gdpr';
import { logger } from 'vscode-debugadapter';
import { SourceMapContents } from './sourceMapContents';

export class SourceMapUrl {
    private readonly _url: PossiblyCustomerContent<string>;
    public readonly isInlineSourceMap: boolean;

    public constructor(url: string) {
        this.isInlineSourceMap = url.indexOf('data:application/json') >= 0;
        this._url = this.isInlineSourceMap ? new CustomerContent(url) : new NonCustomerContent(url);
    }

    public static maybeUndefined(url: string | undefined): SourceMapUrl | undefined {
        if (url) {
            return new SourceMapUrl(url);
        } else {
            return undefined; // Convert '' to undefined
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
}
