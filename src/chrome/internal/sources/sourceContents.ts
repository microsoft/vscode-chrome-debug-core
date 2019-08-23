/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { PossiblyCustomerContent } from '../../logging/gdpr';

export type SourceContents = PossiblyCustomerContent<string>;

export function truncate(possiblyCustomerContent: PossiblyCustomerContent<string>): PossiblyCustomerContent<string> {
    const maxLength = 1e5;
    return possiblyCustomerContent.customerContentData.length > maxLength
        ? possiblyCustomerContent.transform(data => data.substr(0, maxLength) + '[⋯]')
        : possiblyCustomerContent;
}
