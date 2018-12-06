import { Container, interfaces } from 'inversify';
import { bindAll } from './bind';

// Hides the current DI framework from the rest of our implementation
export class DependencyInjection {
    private readonly _container = new Container({ autoBindInjectable: true });

    constructor() {
    }

    public configureClass<T>(interfaceClass: interfaces.Newable<T> | symbol, value: interfaces.Newable<T>): this {
        this._container.bind(interfaceClass).toConstructor(value);
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

    public bindAll(): this {
        bindAll(this._container);
        return this;
    }
}
