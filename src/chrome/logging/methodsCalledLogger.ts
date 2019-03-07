/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as _ from 'lodash';
import { printTopLevelObjectDescription } from './printObjectDescription';
import { logger } from 'vscode-debugadapter';

enum Synchronicity {
    Sync,
    Async
}

enum Outcome {
    Succesful,
    Failure
}

export class ReplacementInstruction {
    public constructor(
        public readonly pattern: RegExp,
        public readonly replacement: string) { }
}

export class MethodsCalledLoggerConfiguration {
    public constructor(readonly replacements: ReplacementInstruction[]) { }
}

export class MethodsCalledLogger<T extends object> {
    constructor(
        private readonly _configuration: MethodsCalledLoggerConfiguration,
        private readonly _objectToWrap: T,
        private readonly _objectToWrapName: string) {
    }

    public wrapped(): T {
        const handler = {
            get: <K extends keyof T>(target: T, propertyKey: K, _receiver: any) => {
                const originalPropertyValue = target[propertyKey];
                if (typeof originalPropertyValue === 'function') {
                    return (...args: any) => {
                        try {
                            const result = originalPropertyValue.apply(target, args);
                            if (!result || !result.then) {
                                this.logCall(propertyKey, Synchronicity.Sync, args, Outcome.Succesful, result);
                                return result;
                            } else {
                                return result.then((promiseResult: unknown) => {
                                    this.logCall(propertyKey, Synchronicity.Async, args, Outcome.Succesful, promiseResult);
                                    return promiseResult;
                                }, (rejection: unknown) => {
                                    this.logCall(propertyKey, Synchronicity.Async, args, Outcome.Failure, rejection);
                                    return rejection;
                                });
                            }
                        } catch (exception) {
                            this.logCall(propertyKey, Synchronicity.Sync, args, Outcome.Failure, exception);
                            throw exception;
                        }
                    };
                } else {
                    return originalPropertyValue;
                }
            }
        };

        return new Proxy<T>(this._objectToWrap, handler);
    }

    private printMethodCall(propertyKey: PropertyKey, methodCallArguments: any[]): string {
        return `${this._objectToWrapName}.${String(propertyKey)}(${this.printArguments(methodCallArguments)})`;
    }

    private printMethodResponse(outcome: Outcome, resultOrException: unknown): string {
        return `${outcome === Outcome.Succesful ? '->' : 'threw'} ${this.printObject(resultOrException)}`;
    }

    private printMethodSynchronicity(synchronicity: Synchronicity): string {
        return `${synchronicity === Synchronicity.Sync ? '' : ' async'}`;
    }

    private logCall(propertyKey: PropertyKey, synchronicity: Synchronicity, methodCallArguments: any[], outcome: Outcome, resultOrException: unknown): void {
        const message = `${this.printMethodCall(propertyKey, methodCallArguments)} ${this.printMethodSynchronicity(synchronicity)}  ${this.printMethodResponse(outcome, resultOrException)}`;
        logger.verbose(message);
    }

    private printArguments(methodCallArguments: any[]): string {
        return methodCallArguments.map(methodCallArgument => this.printObject(methodCallArgument)).join(', ');
    }

    private printObject(objectToPrint: unknown): string {
        const description = printTopLevelObjectDescription(objectToPrint);
        const printtedReduced = _.reduce(Array.from(this._configuration.replacements),
            (text, replacement) =>
                text.replace(replacement.pattern, replacement.replacement),
            description);

        return printtedReduced;
    }
}

export function wrapWithMethodLogger<T extends object>(objectToWrap: T, objectToWrapName = `${objectToWrap}`): T {
    return new MethodsCalledLogger(new MethodsCalledLoggerConfiguration([]), objectToWrap, objectToWrapName).wrapped();
}