/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Container, interfaces } from 'inversify';
import { bindAll } from './bind';
import { MethodsCalledLoggerConfiguration, ReplacementInstruction } from '../logging/methodsCalledLogger';
import { addCDTPBindings } from '../cdtpDebuggee/cdtpDIContainer';
import { addBreakpointsFeatureBindings } from '../internal/breakpoints/diBindings';
import { ValidatedMap } from '../collections/validatedMap';

export type GetComponentByID = <T>(identifier: interfaces.ServiceIdentifier<T>) => T;
export type ComponentCustomizationCallback = <T>(identifier: interfaces.ServiceIdentifier<T>, injectable: T, getComponentById: GetComponentByID) => T;

export type IdentifierToClass = IdentifierToClassMapping | IdentifierToClassPairs;
export type IdentifierToClassMapping = Map<interfaces.ServiceIdentifier<any>, interfaces.Newable<any>>;
export type IdentifierToClassPairs = [interfaces.ServiceIdentifier<any>, interfaces.Newable<any>][];

// Hides the current DI framework from the rest of our implementation
export class DependencyInjection {
    private readonly _container = new Container({ autoBindInjectable: true, defaultScope: 'Singleton' });
    private readonly _loggingConfiguration = new MethodsCalledLoggerConfiguration([]);

    constructor(private readonly _name: string, private readonly _componentCustomizationCallback: ComponentCustomizationCallback, parentContainer?: interfaces.Container) {
        (<any>this._container).__msft_name = _name; // This name is for debugging purposes, so we can see the name of the container while we debug it
        if (parentContainer !== undefined) {
            this._container.parent = parentContainer;
        }
    }

    public configureClass<T>(interfaceClass: interfaces.ServiceIdentifier<T>, value: interfaces.Newable<T>): this {
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

    public createComponent<T>(componentIdentifier: interfaces.ServiceIdentifier<T>): T {
        const component = this._container.get<T>(componentIdentifier);
        if (component instanceof Error) {
            throw component;
        }

        return component;
    }

    public bindAll(): this {
        addCDTPBindings(this);
        addBreakpointsFeatureBindings(this);
        bindAll(this._loggingConfiguration, this._container, this._componentCustomizationCallback);
        return this;
    }

    public updateLoggingReplacements(replacements: ReplacementInstruction[]): void {
        this._loggingConfiguration.updateReplacements(replacements);
    }

    public configureFactory<T>(interfaceClass: interfaces.ServiceIdentifier<T>, dynamicValueProvider: (context: interfaces.Context) => T): this {
        this._container.bind(interfaceClass).toDynamicValue(dynamicValueProvider).inSingletonScope();
        return this;
    }

    public configureMultipleClasses(identifierToClassMapping: IdentifierToClass): this {
        for (const entry of identifierToClassMapping) {
            this.configureClass(entry[0], entry[1]);
        }

        return this;
    }

    public importFromOtherContainer(identifiersToImportFromOtherContainer: IterableIterator<interfaces.ServiceIdentifier<any>>, containerToBindFrom: DependencyInjection): this {
        for (const identifierToImport of identifiersToImportFromOtherContainer) {
            this.configureFactory(identifierToImport, () => containerToBindFrom.createComponent(identifierToImport));
        }

        return this;
    }

    public configureExportedAndPrivateClasses(subcontainerName: string, exportedClassesMapping: IdentifierToClass, privateClassesMapping: IdentifierToClassMapping): this {
        const privateClassesContainer = new DependencyInjection(subcontainerName, (_identifier, component) => component, this._container)
            .configureMultipleClasses(privateClassesMapping);

        this.configureMultipleClasses(exportedClassesMapping);
        this.importFromOtherContainer(privateClassesMapping.keys(), privateClassesContainer);

        return this;
    }
}
