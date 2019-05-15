/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { IFormattedExceptionLineDescription } from '../formattedExceptionParser';
import { ConnectedCDAConfiguration } from '../../client/chromeDebugAdapter/cdaConfiguration';
import { isFalse } from '../../utils/typedOperators';

/**
 * Print a stack trace to a format suitable for the client
 */
export class ExceptionStackTracePrinter {
    public constructor(private readonly _configuration: ConnectedCDAConfiguration) { }

    public isZeroBased(): boolean {
        return isFalse(this._configuration.clientCapabilities.linesStartAt1);
    }

    public toStackTraceString(formattedExceptionLines: IFormattedExceptionLineDescription[]): string {
        const stackTraceLines = formattedExceptionLines.map(line => line.generateDescription(this.isZeroBased()));
        const stackTracePrinted = stackTraceLines.join('\n') + '\n';
        return stackTracePrinted;
    }
}