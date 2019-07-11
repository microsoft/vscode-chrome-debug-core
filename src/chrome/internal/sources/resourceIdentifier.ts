/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as path from 'path';
import { IValidatedMap } from '../../collections/validatedMap';
import { MapUsingProjection } from '../../collections/mapUsingProjection';
import { IEquivalenceComparable } from '../../utils/equivalence';
import * as utils from '../../../utils';
import { SetUsingProjection } from '../../collections/setUsingProjection';
import { hasMatches } from '../../utils/typedOperators';

/**
 * Hierarchy:
 * IResourceIdentifier: Identifies a resource
 *   IResourceLocation: Identifies and tells us how to get the resource
 *     URL: Url
 *       LocalFileURL: file:///<something here>
 *       NonLocalFileURL: Every URL except file:///<something here>
 *     LocalFilePath: An OS format to identify it's files
 *       WindowLocalFilePath: Windows format to identify its files
 *       UnixLocalFilePath: *nix (Unix, Linux, Mac) format to identify its files
 *       UnrecognizedFilePath: If we cannot recognize it as a Windows or *nix format we'll asume it's a format we don't understand
 *   ResourceName: Identifies a resource without telling us how to get it
 */

/** This interface represents a text to identify a particular resource. This class will properly compare urls and file paths, while preserving the original case that was used for the identifier */
const ImplementsResourceIdentifier = Symbol();
export interface IResourceIdentifier<TString = string> extends IEquivalenceComparable {
    [ImplementsResourceIdentifier]: void;

    readonly textRepresentation: TString;
    readonly canonicalized: string;
    isEquivalentTo(right: IResourceIdentifier<TString>): boolean;
    isLocalFilePath(): boolean;
}

export function isResourceIdentifier(object: object): object is IResourceIdentifier<string> {
    return object.hasOwnProperty(ImplementsResourceIdentifier);
}

abstract class IsEquivalentCommonLogic {
    [ImplementsResourceIdentifier]: void;

    public abstract get canonicalized(): string;

    public isEquivalentTo(right: IResourceIdentifier): boolean {
        return this.canonicalized === right.canonicalized;
    }

    public isLocalFilePath(): boolean {
        return false;
    }
}

abstract class IsEquivalentAndConstructorCommonLogic<TString extends string = string> extends IsEquivalentCommonLogic {
    public get textRepresentation(): TString {
        return this._textRepresentation;
    }

    constructor(private _textRepresentation: TString) {
        super();
    }

    public get canonicalized(): string {
        return this.textRepresentation;
    }

    public toString(): string {
        return `${this.textRepresentation}`;
    }
}

// A resource name is any string that identifies the resource, but doesn't tell us how to find it's contents
export class ResourceName<TString extends string = string> extends IsEquivalentAndConstructorCommonLogic<TString> implements IResourceIdentifier<TString> { }

// A resource location is any string that identifies the resource, and also tell us how to find it's contents
export interface IResourceLocation<TString extends string = string> extends IResourceIdentifier<TString> { }

// A standard URL
export interface IURL<TString extends string = string> extends IResourceLocation<TString> { }

// A local file URL is a 'file:///' url
export class LocalFileURL<TString extends string = string> extends IsEquivalentCommonLogic implements IURL<TString> {
    private _localResourcePath: ILocalFilePath;

    constructor(private readonly _fileUrl: TString) {
        super();
        let filePath = utils.fileUrlToPath(_fileUrl);
        this._localResourcePath = parseLocalResourcePath(filePath);
    }

    public static isValid(path: string) {
        return path.startsWith('file:///');
    }

    public get textRepresentation(): TString {
        return this._fileUrl; // We preserve the exact representation that was given to us. If we unescape a character, CRDP will consider it to be a different url
    }

    public get filePathRepresentation(): string {
        // TODO: Migrate to url.fileURLToPath after VS Code migrates to node v10.12
        return this._localResourcePath.textRepresentation;
    }

    public get canonicalized(): string {
        return this._localResourcePath.canonicalized;
    }

    public isLocalFilePath(): boolean {
        return true;
    }

    public toString(): string {
        return path.basename(this.textRepresentation);
    }
}

// Any URL that is not a 'file:///' url
export class NonLocalFileURL<TString extends string = string> extends IsEquivalentAndConstructorCommonLogic<TString> implements IURL<TString> {
    [ImplementsResourceIdentifier]: void;

    public toString(): string {
        return path.basename(this.textRepresentation);
    }
}

// A local resource location is any string that identifies the resource in the local computer, and also tell us how to find it's contents
// e.g.: /home/user/proj/myfile.js
// e.g.: C:\proj\myfile.js
export interface ILocalFilePath<TString extends string = string> extends IResourceLocation<TString> { }

abstract class LocalFilePathCommonLogic<TString extends string = string> extends IsEquivalentAndConstructorCommonLogic<TString> {
    private _canonicalized: string;

    constructor(textRepresentation: TString) {
        super(textRepresentation);
        this._canonicalized = this.generateCanonicalized();
    }

    public get canonicalized(): string {
        return this._canonicalized;
    }

    public isLocalFilePath(): boolean {
        return true;
    }

    protected abstract generateCanonicalized(): string;

    public toString(): string {
        return `res:${this.textRepresentation}`;
    }
}

// A unix local resource location is a *nix path
// e.g.: /home/user/proj/myfile.js
export class UnixLocalFilePath<TString extends string = string> extends LocalFilePathCommonLogic<TString> implements ILocalFilePath<TString> {
    public static isValid(path: string) {
        return path.startsWith('/');
    }

    protected generateCanonicalized(): string {
        const normalized = path.normalize(this.textRepresentation); // Remove ../s
        return normalized.replace(/(?:\\\/|\/)+/, '/');
    }
}

// A windows local file path
// e.g.: C:\proj\myfile.js
export class WindowLocalFilePath<TString extends string = string> extends LocalFilePathCommonLogic<TString> implements ILocalFilePath<TString> {
    public constructor(textRepresentation: TString) {
        super(WindowLocalFilePath.normalize(textRepresentation));
    }

    public static isValid(path: string): boolean {
        return hasMatches(path.match(/^[A-Za-z]:/));
    }

    private static normalize<TString extends string>(textRepresentation: TString): TString {
        const normalized = path.normalize(textRepresentation); // Remove ../s
        return <TString>normalized.replace(/[\\\/]+/, '\\');
    }

    protected generateCanonicalized(): string {
        return this.textRepresentation.toLowerCase();
    }
}

// Any file path that we don't recognize as Windows nor Linux
export class UnrecognizedFilePath<TString extends string = string> extends IsEquivalentAndConstructorCommonLogic<TString> implements ILocalFilePath<TString> { }

function parseWindowsOrUnixLocalResourcePath<TString extends string = string>(path: TString): ILocalFilePath<TString> | null {
    if (WindowLocalFilePath.isValid(path)) {
        return new WindowLocalFilePath<TString>(path);
    } else if (UnixLocalFilePath.isValid(path)) {
        return new UnixLocalFilePath<TString>(path);
    } else {
        return null;
    }
}

function parseLocalResourcePath<TString extends string = string>(path: TString): ILocalFilePath<TString> {
    const recognizedLocalResourcePath = parseWindowsOrUnixLocalResourcePath<TString>(path);
    if (recognizedLocalResourcePath !== null) {
        return recognizedLocalResourcePath;
    } else {
        return new UnrecognizedFilePath<TString>(path);
    }
}

function parseURL<TString extends string = string>(textRepresentation: TString): IURL<TString> {
    if (LocalFileURL.isValid(textRepresentation)) {
        return new LocalFileURL<TString>(textRepresentation);
    } else {
        return new NonLocalFileURL<TString>(textRepresentation);
    }
}

/**
 * Sample formats:
 * file:///D:\\scripts\\code.js
 * file:///Users/me/project/code.js
 * c:/scripts/code.js
 * http://site.com/scripts/code.js
 * http://site.com/
 */
export function parseResourceIdentifier<TString extends string = string>(textRepresentation: TString): IResourceIdentifier<TString> {
    if (typeof textRepresentation === 'string') {
        if (utils.isURL(textRepresentation)) {
            return parseURL(textRepresentation);
        } else { // It could be a file path or a name
            const recognizedLocalResourcePath = parseWindowsOrUnixLocalResourcePath(textRepresentation);
            if (recognizedLocalResourcePath !== null) {
                return recognizedLocalResourcePath;
            } else {
                // If we don't recognize this as any known formats, we assume it's an opaque identifier (a name)
                return new ResourceName(textRepresentation);
            }
        }
    } else {
        throw new Error(`Can't parse the resource identifier because the text representation was expected to be a string yet it was: ${textRepresentation}`);
    }
}

export function parseResourceIdentifiers(textRepresentations: string[]): IResourceIdentifier[] {
    return textRepresentations.map(parseResourceIdentifier);
}

export function newResourceIdentifierMap<V, TString extends string = string>(
    initialContents: Map<IResourceIdentifier<TString>, V> | Iterable<[IResourceIdentifier<TString>, V]>
        | ReadonlyArray<[IResourceIdentifier<TString>, V]> = []): IValidatedMap<IResourceIdentifier<TString>, V> {
    return new MapUsingProjection<IResourceIdentifier<TString>, V, string>(path => path.canonicalized, initialContents);
}

export function newResourceIdentifierSet<TString extends string = string>(
    initialContents: IResourceIdentifier<TString>[] = []): SetUsingProjection<IResourceIdentifier<TString>, string> {
    return new SetUsingProjection<IResourceIdentifier<TString>, string>(path => path.canonicalized, initialContents);
}
