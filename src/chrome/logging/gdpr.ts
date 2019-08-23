/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/** Used to store data that can potentially be customer content. If it is, we should never log it or send it over telemetry */
 export interface PossiblyCustomerContent<T> {
    customerContentData: T;

    /** Transform the data. If it is customer data, the result will sill be customer data */
    transform<U>(transformFunction: (customerContentData: T) => U): PossiblyCustomerContent<U>;
}

/** Used to protect CustomerContent data so we don't inadvertently log it or send it as telemetry */
export class CustomerContent<T> implements PossiblyCustomerContent<T> {
    public constructor(data: T) {
        Object.defineProperty(this, 'customerContentData', {
            get: () => data
        });
    }

    public transform<U>(transformFunction: (customerContentData: T) => U): PossiblyCustomerContent<U> {
        return new CustomerContent(transformFunction(this.customerContentData));
    }

    public toString(): string {
        return `CustomerContent`;
    }
}

export interface CustomerContent<T> {
    customerContentData: T; // class CustomerContent<T> has this member, and it's created on the constructor
}

export class NonCustomerContent<T> implements PossiblyCustomerContent<T> {
    public constructor(public customerContentData: T) {}

    public transform<U>(transformFunction: (customerContentData: T) => U): PossiblyCustomerContent<U> {
        return new NonCustomerContent(transformFunction(this.customerContentData));
    }
}
