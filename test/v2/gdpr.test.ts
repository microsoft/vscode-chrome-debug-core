/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

 import { CustomerContent } from '../../src/chrome/logging/gdpr';
import * as assert from 'assert';
import * as util from 'util';

suite('PII', () => {
    const someCustomerContent = 'Customer content';
    const piiObject = new CustomerContent(someCustomerContent);

    function assertDoesNotContainPII(strignified: string) {
        assert.equal(strignified.indexOf(someCustomerContent), -1);
    }

    test(`JSON.stringify doesn't reveal PII`, () => {
        assertDoesNotContainPII(JSON.stringify(piiObject));
    });

    test(`util.inspect doesn't reveal PII`, () => {
        assertDoesNotContainPII(util.inspect(piiObject));
    });

    test(`getPIIData retrieves PII`, () => {
        assert.equal(piiObject.customerContentData, someCustomerContent);
    });
});
