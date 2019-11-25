/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { logger } from 'vscode-debugadapter';
import { IVariablesResponseBody,
    ISetVariableResponseBody } from '../debugAdapterInterfaces';
import * as ChromeUtils from './chromeUtils';
import { Protocol as Crdp } from 'devtools-protocol';
import { IPropCount, isIndexedPropName, IVariableContainer } from './variables';
import * as variables from './variables';
import * as errors from '../errors';
import * as utils from '../utils';
import { VariableContext } from './chromeDebugAdapter';
import { ChromeConnection } from './chromeConnection';

/**
 * A container for managing get/set variable calls
 */
export class VariablesManager {

    private _variableHandles: variables.VariableHandles;
    private get chrome() { return this._chromeConnection.api; }

    constructor(private readonly _chromeConnection: ChromeConnection) {
        this._variableHandles = new variables.VariableHandles();
    }

    public getVariables(args: DebugProtocol.VariablesArguments): Promise<IVariablesResponseBody | undefined> {
        if (!this.chrome) {
            return utils.errP(errors.runtimeNotConnectedMsg);
        }

        const handle = this._variableHandles.get(args.variablesReference);
        if (!handle) {
            return Promise.resolve<IVariablesResponseBody>(undefined);
        }

        return handle.expand(this, args.filter, args.start, args.count)
            .catch(err => {
                logger.log('Error handling variables request: ' + err.toString());
                return [];
            }).then(variables => {
                return { variables };
            });
    }

    public getVariablesForObjectId(objectId: string, evaluateName?: string, filter?: string, start?: number, count?: number): Promise<DebugProtocol.Variable[]> {
        if (typeof start === 'number' && typeof count === 'number') {
            return this.getFilteredVariablesForObject(objectId, evaluateName, filter, start, count);
        }

        filter = filter === 'indexed' ? 'all' : filter;

        return Promise.all([
            // Need to make two requests to get all properties
            this.getRuntimeProperties({ objectId, ownProperties: false, accessorPropertiesOnly: true, generatePreview: true }),
            this.getRuntimeProperties({ objectId, ownProperties: true, accessorPropertiesOnly: false, generatePreview: true })
        ]).then(getPropsResponses => {
            // Sometimes duplicates will be returned - merge all descriptors by name
            const propsByName = new Map<string, Crdp.Runtime.PropertyDescriptor>();
            const internalPropsByName = new Map<string, Crdp.Runtime.InternalPropertyDescriptor>();
            getPropsResponses.forEach(response => {
                if (response) {
                    response.result.forEach(propDesc =>
                        propsByName.set(propDesc.name, propDesc));

                    if (response.internalProperties) {
                        response.internalProperties.forEach(internalProp => {
                            internalPropsByName.set(internalProp.name, internalProp);
                        });
                    }
                }
            });

            // Convert Chrome prop descriptors to DebugProtocol vars
            const variables: Promise<DebugProtocol.Variable>[] = [];
            propsByName.forEach(propDesc => {
                if (!filter || filter === 'all' || (isIndexedPropName(propDesc.name) === (filter === 'indexed'))) {
                    variables.push(this.propertyDescriptorToVariable(propDesc, objectId, evaluateName));
                }
            });

            internalPropsByName.forEach(internalProp => {
                if (!filter || filter === 'all' || (isIndexedPropName(internalProp.name) === (filter === 'indexed'))) {
                    variables.push(Promise.resolve(this.internalPropertyDescriptorToVariable(internalProp, evaluateName)));
                }
            });

            return Promise.all(variables);
        }).then(variables => {
            // Sort all variables properly
            return variables.sort((var1, var2) => ChromeUtils.compareVariableNames(var1.name, var2.name));
        });
    }

    public onPaused() {
        this._variableHandles.onPaused();
    }

    public createHandle(value: IVariableContainer, context?: VariableContext): number {
        return this._variableHandles.create(value, context);
    }

    public setPropertyValue(objectId: string, propName: string, value: string): Promise<string> {
        const setPropertyValueFn = `function() { return this["${propName}"] = ${value}; }`;
        return this.chrome.Runtime.callFunctionOn({
            objectId,
            functionDeclaration: setPropertyValueFn,
            silent: true
        }).then(response => {
            if (response.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                return Promise.reject<string>(errors.errorFromEvaluate(errMsg));
            } else {
                // Temporary, Microsoft/vscode#12019
                return ChromeUtils.remoteObjectToValue(response.result).value;
            }
        },
        error => Promise.reject<string>(errors.errorFromEvaluate(error.message)));
    }

    private getRuntimeProperties(params: Crdp.Runtime.GetPropertiesRequest): Promise<Crdp.Runtime.GetPropertiesResponse> {
        return this.chrome.Runtime.getProperties(params)
            .catch(err => {
                if (err.message.startsWith('Cannot find context with specified id')) {
                    // Hack to ignore this error until we fix https://github.com/Microsoft/vscode/issues/18001 to not request variables at unexpected times.
                    return null;
                } else {
                    throw err;
                }
            });
    }

    private getFilteredVariablesForObject(objectId: string, evaluateName: string, filter: string, start: number, count: number): Promise<DebugProtocol.Variable[]> {
        // No ES6, in case we talk to an old runtime
        const getIndexedVariablesFn = `
            function getIndexedVariables(start, count) {
                var result = [];
                for (var i = start; i < (start + count); i++) result[i] = this[i];
                return result;
            }`;
        // TODO order??
        const getNamedVariablesFn = `
            function getNamedVariablesFn(start, count) {
                var result = [];
                var ownProps = Object.getOwnPropertyNames(this);
                for (var i = start; i < (start + count); i++) result[i] = ownProps[i];
                return result;
            }`;

        const getVarsFn = filter === 'indexed' ? getIndexedVariablesFn : getNamedVariablesFn;
        return this.getFilteredVariablesForObjectId(objectId, evaluateName, getVarsFn, filter, start, count);
    }

    private getFilteredVariablesForObjectId(objectId: string, evaluateName: string, getVarsFn: string, filter: string, start: number, count: number): Promise<DebugProtocol.Variable[]> {
        return this.chrome.Runtime.callFunctionOn({
            objectId,
            functionDeclaration: getVarsFn,
            arguments: [{ value: start }, { value: count }],
            silent: true
        }).then<DebugProtocol.Variable[]>(evalResponse => {
            if (evalResponse.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(evalResponse.exceptionDetails);
                return Promise.reject(errors.errorFromEvaluate(errMsg));
            } else {
                // The eval was successful and returned a reference to the array object. Get the props, then filter
                // out everything except the index names.
                return this.getVariablesForObjectId(evalResponse.result.objectId, evaluateName, filter)
                    .then(variables => variables.filter(variable => isIndexedPropName(variable.name)));
            }
        },
        error => Promise.reject(errors.errorFromEvaluate(error.message)));
    }

    public setVariable(args: DebugProtocol.SetVariableArguments): Promise<ISetVariableResponseBody> {
        const handle = this._variableHandles.get(args.variablesReference);
        if (!handle) {
            return Promise.reject(errors.setValueNotSupported());
        }

        return handle.setValue(this, args.name, args.value)
            .then(value => ({ value }));
    }

    public setVariableValue(callFrameId: string, scopeNumber: number, variableName: string, value: string): Promise<string> {
        let evalResultObject: Crdp.Runtime.RemoteObject;
        return this.chrome.Debugger.evaluateOnCallFrame({ callFrameId, expression: value, silent: true }).then(evalResponse => {
            if (evalResponse.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(evalResponse.exceptionDetails);
                return Promise.reject(errors.errorFromEvaluate(errMsg));
            } else {
                evalResultObject = evalResponse.result;
                const newValue = ChromeUtils.remoteObjectToCallArgument(evalResultObject);
                return this.chrome.Debugger.setVariableValue({ callFrameId, scopeNumber, variableName, newValue });
            }
        },
        error => Promise.reject(errors.errorFromEvaluate(error.message)))
        // Temporary, Microsoft/vscode#12019
        .then(() => ChromeUtils.remoteObjectToValue(evalResultObject).value);
    }

    public createObjectVariable(name: string, object: Crdp.Runtime.RemoteObject, parentEvaluateName: string, context: VariableContext): Promise<DebugProtocol.Variable> {
        if ((<string>object.subtype) === 'internal#location') {
            // Could format this nicely later, see #110
            return Promise.resolve(variables.createPrimitiveVariableWithValue(name, 'internal#location', parentEvaluateName));
        } else if (object.subtype === 'null') {
            return Promise.resolve(variables.createPrimitiveVariableWithValue(name, 'null', parentEvaluateName));
        }

        const value = variables.getRemoteObjectPreview_object(object, context);
        let propCountP: Promise<IPropCount>;
        if (object.subtype === 'array' || object.subtype === 'typedarray') {
            if (object.preview && !object.preview.overflow) {
                propCountP = Promise.resolve(variables.getArrayNumPropsByPreview(object));
            } else if (object.className === 'Buffer') {
                propCountP = this.getBufferNumPropsByEval(object.objectId);
            } else {
                propCountP = this.getArrayNumPropsByEval(object.objectId);
            }
        } else if (object.subtype === 'set' || object.subtype === 'map') {
            if (object.preview && !object.preview.overflow) {
                propCountP = Promise.resolve(variables.getCollectionNumPropsByPreview(object));
            } else {
                propCountP = this.getCollectionNumPropsByEval(object.objectId);
            }
        } else {
            propCountP = Promise.resolve({
                indexedVariables: undefined,
                namedVariables: undefined
            });
        }

        const evaluateName = ChromeUtils.getEvaluateName(parentEvaluateName, name);
        const variablesReference = this._variableHandles.create(variables.createPropertyContainer(object, evaluateName), context);
        return propCountP.then(({ indexedVariables, namedVariables }) => (<DebugProtocol.Variable>{
            name,
            value,
            type: utils.uppercaseFirstLetter(object.type),
            variablesReference,
            indexedVariables,
            namedVariables,
            evaluateName
        }));
    }

    public async propertyDescriptorToVariable(propDesc: Crdp.Runtime.PropertyDescriptor, owningObjectId?: string, parentEvaluateName?: string): Promise<DebugProtocol.Variable> {
        if (propDesc.get) {
            // Getter
            const grabGetterValue = 'function remoteFunction(propName) { return this[propName]; }';

            let response: Crdp.Runtime.CallFunctionOnResponse;
            try {
                response = await this.chrome.Runtime.callFunctionOn({
                    objectId: owningObjectId,
                    functionDeclaration: grabGetterValue,
                    arguments: [{ value: propDesc.name }]
                });
            } catch (error) {
                logger.error(`Error evaluating getter for '{propDesc.name}' - {error.toString()}`);
                return { name: propDesc.name, value: error.toString(), variablesReference: 0 };
            }

            if (response.exceptionDetails) {
                // Not an error, getter could be `get foo() { throw new Error('bar'); }`
                const exceptionMessage = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                logger.verbose('Exception thrown evaluating getter - ' + exceptionMessage);
                return { name: propDesc.name, value: exceptionMessage, variablesReference: 0 };
            } else {
                return this.remoteObjectToVariable(propDesc.name, response.result, parentEvaluateName);
            }
        } else if (propDesc.set) {
            // setter without a getter, unlikely
            return { name: propDesc.name, value: 'setter', variablesReference: 0 };
        } else {
            // Non getter/setter
            return this.internalPropertyDescriptorToVariable(propDesc, parentEvaluateName);
        }
    }

    private getArrayNumPropsByEval(objectId: string): Promise<IPropCount> {
        // +2 for __proto__ and length
        const getNumPropsFn = `function() { return [this.length, Object.keys(this).length - this.length + 2]; }`;
        return this.getNumPropsByEval(objectId, getNumPropsFn);
    }

    private getBufferNumPropsByEval(objectId: string): Promise<IPropCount> {
        // +2 for __proto__ and length
        // Object.keys doesn't return other props from a Buffer
        const getNumPropsFn = `function() { return [this.length, 0]; }`;
        return this.getNumPropsByEval(objectId, getNumPropsFn);
    }

    private getCollectionNumPropsByEval(objectId: string): Promise<IPropCount> {
        const getNumPropsFn = `function() { return [0, Object.keys(this).length + 1]; }`; // +1 for [[Entries]];
        return this.getNumPropsByEval(objectId, getNumPropsFn);
    }

    private getNumPropsByEval(objectId: string, getNumPropsFn: string): Promise<IPropCount> {
        return this.chrome.Runtime.callFunctionOn({
            objectId,
            functionDeclaration: getNumPropsFn,
            silent: true,
            returnByValue: true
        }).then(response => {
            if (response.exceptionDetails) {
                const errMsg = ChromeUtils.errorMessageFromExceptionDetails(response.exceptionDetails);
                return Promise.reject<IPropCount>(errors.errorFromEvaluate(errMsg));
            } else {
                const resultProps = response.result.value;
                if (resultProps.length !== 2) {
                    return Promise.reject<IPropCount>(errors.errorFromEvaluate('Did not get expected props, got ' + JSON.stringify(resultProps)));
                }

                return { indexedVariables: resultProps[0], namedVariables: resultProps[1] };
            }
        },
        error => Promise.reject<IPropCount>(errors.errorFromEvaluate(error.message)));
    }

    public async remoteObjectToVariable(name: string, object: Crdp.Runtime.RemoteObject, parentEvaluateName?: string, stringify = true, context: VariableContext = 'variables'): Promise<DebugProtocol.Variable> {
        name = name || '""';

        if (object) {
            if (object.type === 'object') {
                return this.createObjectVariable(name, object, parentEvaluateName, context);
            } else if (object.type === 'function') {
                return variables.createFunctionVariable(name, object, context, this._variableHandles, parentEvaluateName);
            } else {
                return variables.createPrimitiveVariable(name, object, parentEvaluateName, stringify);
            }
        } else {
            return variables.createPrimitiveVariableWithValue(name, '', parentEvaluateName);
        }
    }

    private internalPropertyDescriptorToVariable(propDesc: Crdp.Runtime.InternalPropertyDescriptor, parentEvaluateName: string): Promise<DebugProtocol.Variable> {
        return this.remoteObjectToVariable(propDesc.name, propDesc.value, parentEvaluateName);
    }

}
