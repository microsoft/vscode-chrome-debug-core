/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { PossiblyCustomerContent, CustomerContent, NonCustomerContent } from '../../logging/gdpr';

export class SourceContents {
    public constructor(public readonly contents: PossiblyCustomerContent<string>) {}

    public static customerContent(contents: string): SourceContents {
        return new SourceContents(new CustomerContent(contents));
    }

    public static nonCustomerContent(contents: string): SourceContents {
        return new SourceContents(new NonCustomerContent(contents));
    }

    public get customerContentData(): string {
        return this.contents.customerContentData;
    }

    public truncated(): SourceContents {
        const maxLength = 1e5;
        return this.customerContentData.length > maxLength
            ? SourceContents.customerContent(this.customerContentData.substr(0, maxLength) + '[⋯]')
            : this;
    }
}
