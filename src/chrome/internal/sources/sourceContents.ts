/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { PossiblyCustomerContent, CustomerContent } from '../../logging/gdpr';

export class SourceContents extends CustomerContent<string> {}

export function truncate(possiblyCustomerContent: PossiblyCustomerContent<string>): PossiblyCustomerContent<string> {
    const maxLength = 1e5;
    return possiblyCustomerContent.customerContentData.length > maxLength
        ? possiblyCustomerContent.transform(data => data.substr(0, maxLength) + '[⋯]')
        : possiblyCustomerContent;
}
