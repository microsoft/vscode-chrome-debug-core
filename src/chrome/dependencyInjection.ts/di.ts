/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Container, interfaces } from 'inversify';
// TODO: Readd after we merge this file import { bindAll } from './bind';
import { MethodsCalledLoggerConfiguration } from '../logging/methodsCalledLogger';

export type GetComponentByID = <T>(identifier: interfaces.ServiceIdentifier<T>) => T;
export type ComponentCustomizationCallback = <T>(identifier: interfaces.ServiceIdentifier<T>, injectable: T, getComponentById: GetComponentByID) => T;

// Hides the current DI framework from the rest of our implementation
export class DependencyInjection {
    private readonly _container = new Container({ autoBindInjectable: true, defaultScope: 'Singleton' });

    constructor(/* Will be used after we merge bind.ts*/ _componentCustomizationCallback: ComponentCustomizationCallback) {
    }

    public configureClass<T>(interfaceClass: interfaces.Newable<T> | symbol, value: interfaces.Newable<T>): this {
        this._container.bind(interfaceClass).to(value).inSingletonScope();
        return this;
    }

    public unconfigure<T>(interfaceClass: interfaces.Newable<T> | symbol): this {
        this._container.unbind(interfaceClass);
        return this;
    }

    public configureValue<T>(valueClass: interfaces.Newable<T> | symbol, value: T): this {
        this._container.bind(valueClass).toConstantValue(value);
        return this;
    }

    public createClassWithDI<T>(classToCreate: interfaces.Newable<T>): T {
        return this._container.get(classToCreate);
    }

    public createComponent<T>(componentIdentifier: symbol): T {
        return this._container.get(componentIdentifier);
    }

    public bindAll(_loggingConfiguration: MethodsCalledLoggerConfiguration): this {
        // TODO: Readd after we merge bind.ts bindAll(loggingConfiguration, this._container, this._componentCustomizationCallback);
        return this;
    }
}
