import { PromiseOrNot } from '../utils/promises';
import { Logging } from '../internal/services/logging';

export interface IExecutionLogger {
    logAsyncFunctionCall<T, R>(description: string, functionToCall: (parameters: T) => PromiseOrNot<R>, parameters: T): PromiseOrNot<R>;
}

export class ExecutionLogger implements IExecutionLogger {
    private _depth = 0;

    public async logAsyncFunctionCall<T, R>(description: string, functionToCall: (parameters: T) => PromiseOrNot<R>, parameters: T): Promise<R> {
        this._logging.verbose(`${this.indentationForDepth()}${description}(${this.printParameters(parameters)})`);
        this._depth++;
        try {
            const result = await functionToCall(parameters);
            this._depth--;
            this._logging.verbose(`${this.indentationForDepth()}${description} = ${this.printResult(result)}`);
            return result;
        } catch (exception) {
            this._depth--;
            this._logging.verbose(`${this.indentationForDepth()}${description} throws ${this.printException(exception)}`);
            throw exception;
        }
    }

    private indentationForDepth(): string {
        return '  '.repeat(this._depth);
    }

    private printParameters<T>(parameters: T): string {
        return `${parameters}`;
    }

    private printResult<T>(parameters: T): string {
        return `${parameters}`;
    }

    private printException(exception: unknown): string {
        return `${exception}`;
    }

    constructor(private readonly _logging: Logging) { }
}