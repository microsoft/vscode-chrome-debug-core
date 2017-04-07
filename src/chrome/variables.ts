/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugProtocol} from 'vscode-debugprotocol';
import {Handles} from 'vscode-debugadapter';

import {ChromeDebugAdapter, VariableContext} from './chromeDebugAdapter';
import Crdp from '../../crdp/crdp';
import * as utils from '../utils';

export interface IVariableContainer {
    expand(adapter: ChromeDebugAdapter, filter?: string, start?: number, count?: number): Promise<DebugProtocol.Variable[]>;
    setValue(adapter: ChromeDebugAdapter, name: string, value: string): Promise<string>;
}

export abstract class BaseVariableContainer implements IVariableContainer {
    constructor(protected objectId: string, protected evaluateName?: string) {
    }

    public expand(adapter: ChromeDebugAdapter, filter?: string, start?: number, count?: number): Promise<DebugProtocol.Variable[]> {
        return adapter.getVariablesForObjectId(this.objectId, this.evaluateName, filter, start, count);
    }

    public setValue(adapter: ChromeDebugAdapter, name: string, value: string): Promise<string> {
        return utils.errP('setValue not supported by this variable type');
    }
}

export class PropertyContainer extends BaseVariableContainer {
    public setValue(adapter: ChromeDebugAdapter, name: string, value: string): Promise<string> {
        return adapter.setPropertyValue(this.objectId, name, value);
    }
}

export class LoggedObjects extends BaseVariableContainer {
    constructor(private args: Crdp.Runtime.RemoteObject[]) {
        super(undefined);
    }

    public expand(adapter: ChromeDebugAdapter, filter?: string, start?: number, count?: number): Promise<DebugProtocol.Variable[]> {
        return Promise.all(this.args.map((arg, i) => adapter.remoteObjectToVariable('' + i, arg, undefined, /*stringify=*/false, 'repl')));
    }
}

export class ScopeContainer extends BaseVariableContainer {
    private _thisObj: Crdp.Runtime.RemoteObject;
    private _returnValue: Crdp.Runtime.RemoteObject;
    private _frameId: string;
    private _origScopeIndex: number;

    public constructor(frameId: string, origScopeIndex: number, objectId: string, thisObj?: Crdp.Runtime.RemoteObject, returnValue?: Crdp.Runtime.RemoteObject) {
        super(objectId, '');
        this._thisObj = thisObj;
        this._returnValue = returnValue;
        this._frameId = frameId;
        this._origScopeIndex = origScopeIndex;
    }

    /**
     * Call super then insert the 'this' object if needed
     */
    public expand(adapter: ChromeDebugAdapter, filter?: string, start?: number, count?: number): Promise<DebugProtocol.Variable[]> {
        // No filtering in scopes right now
        return super.expand(adapter, 'all', start, count).then(variables => {
            if (this._thisObj) {
                // If this is a scope that should have the 'this', prop, insert it at the top of the list
                return this.insertRemoteObject(adapter, variables, 'this', this._thisObj);
            }

            return variables;
        }).then(variables => {
            if (this._returnValue) {
                return this.insertRemoteObject(adapter, variables, 'Return value', this._returnValue);
            }

            return variables;
        });
    }

    public setValue(adapter: ChromeDebugAdapter, name: string, value: string): Promise<string> {
        return adapter.setVariableValue(this._frameId, this._origScopeIndex, name, value);
    }

    private insertRemoteObject(adapter: ChromeDebugAdapter, variables: DebugProtocol.Variable[], name: string, obj: Crdp.Runtime.RemoteObject): Promise<DebugProtocol.Variable[]> {
        return adapter.remoteObjectToVariable(name, obj).then(variable => {
            variables.unshift(variable);
            return variables;
        });
    }
}

export class ExceptionContainer extends PropertyContainer {
    protected _exception: Crdp.Runtime.RemoteObject;

    protected constructor(objectId: string, exception: Crdp.Runtime.RemoteObject) {
        super(exception.objectId, undefined);
        this._exception = exception;
    }

    /**
     * Expand the exception as if it were a Scope
     */
    public static create(exception: Crdp.Runtime.RemoteObject): ExceptionContainer {
        return exception.objectId ?
            new ExceptionContainer(exception.objectId, exception) :
            new ExceptionValueContainer(exception);
    }
}

/**
 * For when a value is thrown instead of an object
 */
export class ExceptionValueContainer extends ExceptionContainer {
    public constructor(exception: Crdp.Runtime.RemoteObject) {
        super('EXCEPTION_ID', exception);
    }

    /**
     * Make up a fake 'Exception' property to hold the thrown value, displayed under the Exception Scope
     */
    public expand(adapter: ChromeDebugAdapter, filter?: string, start?: number, count?: number): Promise<DebugProtocol.Variable[]> {
        const excValuePropDescriptor: Crdp.Runtime.PropertyDescriptor = <any>{ name: 'Exception', value: this._exception };
        return adapter.propertyDescriptorToVariable(excValuePropDescriptor)
            .then(variable => [variable]);
    }
}

export function isIndexedPropName(name: string): boolean {
    return !!name.match(/^\d+$/);
}

const PREVIEW_PROPS_DEFAULT = 3;
const PREVIEW_PROPS_CONSOLE = 8;
const PREVIEW_PROP_LENGTH = 50;
const ELLIPSIS = '…';
function getArrayPreview(object: Crdp.Runtime.RemoteObject, context?: string): string {
    let value = object.description;
    if (object.preview) {
        const numProps = context === 'repl' ? PREVIEW_PROPS_CONSOLE : PREVIEW_PROPS_DEFAULT;
        const indexedProps = object.preview.properties
            .filter(prop => isIndexedPropName(prop.name));

        // Take the first 3 props, and parse the indexes
        const propsWithIdx = indexedProps.slice(0, numProps)
            .map((prop, i) => {
                return {
                    idx: parseInt(prop.name, 10),
                    value: propertyPreviewToString(prop)
                };
            });

        // Insert ... where there are undefined indexes
        const propValues: string[] = [];
        for (let i = 0; i < propsWithIdx.length; i++) {
            const prop = propsWithIdx[i];

            const prevIdx = i === 0 ? -1 : propsWithIdx[i - 1].idx;
            if (prop.idx > prevIdx + 1) {
                propValues.push(ELLIPSIS);
            }

            propValues.push(prop.value);
        }

        let propsPreview = propValues.join(', ');
        if (object.preview.overflow || indexedProps.length > numProps) {
            propsPreview += ', ' + ELLIPSIS;
        }

        value += ` [${propsPreview}]`;
    }

    return value;
}

function getObjectPreview(object: Crdp.Runtime.RemoteObject, context?: string): string {
    let value = object.description;
    if (object.preview) {
        const numProps = context === 'repl' ? PREVIEW_PROPS_CONSOLE : PREVIEW_PROPS_DEFAULT;
        const props = object.preview.properties.slice(0, numProps);
        let propsPreview = props
            .map(prop => {
                const name = prop.name || `""`;
                return `${name}: ${propertyPreviewToString(prop)}`;
            })
            .join(', ');

        if (object.preview.overflow || object.preview.properties.length > numProps) {
            propsPreview += ', …';
        }

        value += ` {${propsPreview}}`;
    }

    return value;
}

function propertyPreviewToString(prop: Crdp.Runtime.PropertyPreview): string {
    const value = typeof prop.value === 'undefined' ?
        `<${prop.type}>` :
        trimProperty(prop.value);

    return prop.type === 'string' ?
        `"${value}"` :
        value;
}

function trimProperty(value: string): string {
    return (value.length > PREVIEW_PROP_LENGTH) ?
        value.substr(0, PREVIEW_PROP_LENGTH) + ELLIPSIS :
        value;
}

export function getRemoteObjectPreview(object: Crdp.Runtime.RemoteObject, stringify = true, context?: string): string {
    if (object) {
        if (object.type === 'object') {
            return getRemoteObjectPreview_object(object, context);
        } else if (object.type === 'function') {
            return getRemoteObjectPreview_function(object, context);
        } else {
            return getRemoteObjectPreview_primitive(object, stringify);
        }
    }

    return '';
}

export function getRemoteObjectPreview_object(object: Crdp.Runtime.RemoteObject, context?: string): string {
    if ((<string>object.subtype) === 'internal#location') {
        // Could format this nicely later, see #110
        return 'internal#location';
    } else if (object.subtype === 'null') {
        return 'null';
    } else if (object.subtype === 'array' || object.subtype === 'typedarray') {
        return getArrayPreview(object, context);
    } else if (object.subtype === 'error') {
        // The Error's description contains the whole stack which is not a nice description.
        // Up to the first newline is just the error name/message.
        const firstNewlineIdx = object.description.indexOf('\n');
        return firstNewlineIdx >= 0 ?
            object.description.substr(0, firstNewlineIdx) :
            object.description;
    } else if (object.subtype === 'promise' && object.preview) {
        const promiseStatus = object.preview.properties.filter(prop => prop.name === '[[PromiseStatus]]')[0];
        return promiseStatus ?
            object.description + ' { ' + promiseStatus.value + ' }' :
            object.description;
    } else if (object.subtype === 'generator' && object.preview) {
        const generatorStatus = object.preview.properties.filter(prop => prop.name === '[[GeneratorStatus]]')[0];
        return generatorStatus ?
            object.description + ' { ' + generatorStatus.value + ' }' :
            object.description;
    } else if (object.type === 'object' && object.preview) {
        return getObjectPreview(object, context);
    } else {
        return object.description;
    }
}

export function getRemoteObjectPreview_primitive(object: Crdp.Runtime.RemoteObject, stringify?: boolean): string {
    // The value is a primitive value, or something that has a description (not object, primitive, or undefined). And force to be string
    if (typeof object.value === 'undefined') {
        return object.description + '';
    } else if (object.type === 'number') {
        // .value is truncated, so use .description, the full string representation
        // Should be like '3' or 'Infinity'.
        return object.description;
    } else if (object.type === 'boolean') {
        // Never stringified
        return '' + object.value;
    } else {
        return stringify ? `"${object.value}"` : object.value;
    }
}

export function getRemoteObjectPreview_function(object: Crdp.Runtime.RemoteObject, context?: string): string {
    const firstBraceIdx = object.description.indexOf('{');
    if (firstBraceIdx >= 0) {
        return object.description.substring(0, firstBraceIdx) + '{ … }';
    } else {
        const firstArrowIdx = object.description.indexOf('=>');
        return firstArrowIdx >= 0 ?
            object.description.substring(0, firstArrowIdx + 2) + ' …' :
            object.description;
    }
}

export class VariableHandles {
    private _variableHandles = new Handles<IVariableContainer>(1);
    private _consoleVariableHandles = new Handles<IVariableContainer>(1e5);

    public onPaused(): void {
        // Only reset the variableHandles, the console vars are still visible
        this._variableHandles.reset();
    }

    public create(value: IVariableContainer, context: VariableContext = 'variables'): number {
        return this.getHandles(context).create(value);
    }

    public get(handle: number): IVariableContainer {
        return this._variableHandles.get(handle) || this._consoleVariableHandles.get(handle);
    }

    private getHandles(context: VariableContext): Handles<IVariableContainer> {
        return context === 'repl' ?
            this._consoleVariableHandles :
            this._variableHandles;
    }
}