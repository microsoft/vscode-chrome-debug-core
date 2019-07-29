/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { Protocol as CDTP } from 'devtools-protocol';
import { IScript } from '../internal/scripts/script';
import { CDTPScriptUrl } from '../internal/sources/resourceIdentifierSubtypes';
import { URLRegexp } from '../internal/locations/subtypes';
import { AlwaysPause, ConditionalPause } from '../internal/breakpoints/bpActionWhenHit';
import { IResourceIdentifier } from '../internal/sources/resourceIdentifier';
import { IBPRecipeForRuntimeSource } from '../internal/breakpoints/baseMappedBPRecipe';
import { MappableBreakpoint } from '../internal/breakpoints/breakpoint';
import { MakePropertyRequired } from '../../typeUtils';
import { isNotEmpty, isDefined } from '../utils/typedOperators';

export type integer = number;
// The IResourceIdentifier<CDTPScriptUrl> is used with the URL that is associated with each Script in CDTP. This should be a URL, but it could also be a string that is not a valid URL
// For that reason we use IResourceIdentifier<CDTPScriptUrl> for this type, instead of IURL<CDTPScriptUrl>
export type CDTPSupportedResources = IScript | IResourceIdentifier<CDTPScriptUrl> | URLRegexp;
export type CDTPSupportedHitActions = AlwaysPause | ConditionalPause;
export type CDTPBPRecipe = IBPRecipeForRuntimeSource<CDTPSupportedResources, CDTPSupportedHitActions>;
export type CDTPBreakpoint = MappableBreakpoint<CDTPSupportedResources>;
const ImplementsFrameId = Symbol();
export type FrameId = string & { [ImplementsFrameId]: 'FrameId' };

export type CDTPNonPrimitiveRemoteObject = MakePropertyRequired<CDTP.Runtime.RemoteObject, 'objectId'>; // objectId won't be null for non primitive values. See https://chromedevtools.github.io/devtools-protocol/tot/Runtime#type-RemoteObject
export type CDTPRemoteObjectOfTypeObject = MakePropertyRequired<CDTPNonPrimitiveRemoteObject, 'preview'>; // preview is only specified for remote objects of type === 'object'
export function validateNonPrimitiveRemoteObject(remoteObject: CDTP.Runtime.RemoteObject): remoteObject is CDTPNonPrimitiveRemoteObject {
    if (isNotEmpty(remoteObject.objectId)) {
        return true;
    } else {
        throw new Error(localize('error.validateNonPrimitiveRemoteObject.invalid', "Expected a non-primitive value to have an object id, yet it doesn't: {0}", JSON.stringify(remoteObject)));
    }
}

export function validateCDTPRemoteObjectOfTypeObject(remoteObject: CDTP.Runtime.RemoteObject): remoteObject is CDTPRemoteObjectOfTypeObject {
    if (remoteObject.type === 'object' && isNotEmpty(remoteObject.objectId) && isDefined(remoteObject.preview)) {
        return true;
    } else {
        throw new Error(localize('error.validateCDTPRemoteObjectOfTypeObject.invalid', `Expected remote object to be of type == 'object' and to have an object id and a preview, yet it doesn't: {0}`, JSON.stringify(remoteObject)));
    }
}