import * as path from 'path';
import { utils } from '../../..';
import { IValidatedMap } from '../../collections/validatedMap';
import { MapUsingProjection } from '../../collections/mapUsingProjection';

/** Hierarchy:
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

export interface IResourceIdentifier<TString = string> {
    readonly textRepresentation: TString;
    readonly canonicalized: string;
    isEquivalent(right: IResourceIdentifier<string>): boolean;
    isLocalFilePath(): boolean;
}

abstract class IsEquivalentCommonLogic {
    public abstract get canonicalized(): string;

    public isEquivalent(right: IResourceIdentifier): boolean {
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
export interface URL<TString extends string = string> extends IResourceLocation<TString> { }

// A local file URL is a 'file:///' url
export class LocalFileURL<TString extends string = string> extends IsEquivalentCommonLogic implements URL<TString> {
    private _localResourcePath: ILocalFilePath;

    public static isValid(path: string) {
        return path.startsWith('file:///');
    }

    public get textRepresentation(): TString {
        return `file://${encodeURIComponent(this._localResourcePath.textRepresentation)}` as TString;
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

    constructor(fileUrl: TString) {
        super();
        let filePath = decodeURIComponent(fileUrl.replace(`^file://`, ''));
        this._localResourcePath = parseLocalResourcePath(filePath);
    }
}

// Any URL that is not a 'file:///' url
export class NonLocalFileURL<TString extends string = string> extends IsEquivalentAndConstructorCommonLogic<TString> implements URL<TString> {
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

    constructor(textRepresentation: TString) {
        super(textRepresentation);
        this._canonicalized = this.generateCanonicalized();
    }
}

// A unix local resource location is a *nix path
// e.g.: /home/user/proj/myfile.js
export class UnixLocalFilePath<TString extends string = string> extends LocalFilePathCommonLogic<TString> implements ILocalFilePath<TString> {
    protected generateCanonicalized(): string {
        const normalized = path.normalize(this.textRepresentation); // Remove ../s
        return normalized.replace(/(?:\\\/|\/)+/, '/');
    }

    public static isValid(path: string) {
        return path.startsWith('/');
    }
}

// A windows local file path
// e.g.: C:\proj\myfile.js
export class WindowLocalFilePath<TString extends string = string> extends LocalFilePathCommonLogic<TString> implements ILocalFilePath<TString> {
    protected generateCanonicalized(): string {
        const normalized = path.normalize(this.textRepresentation); // Remove ../s
        return normalized.toLowerCase().replace(/[\\\/]+/, '\\');
    }

    public static isValid(path: string) {
        return path.match(/^[A-Za-z]:/);
    }

    public get canonicalized(): string {
        return this.textRepresentation.toLowerCase().replace(/[\\\/]+/, '\\');
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

function parseURL<TString extends string = string>(textRepresentation: TString): URL<TString> {
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
}

export function parseResourceIdentifiers(textRepresentations: string[]): IResourceIdentifier[] {
    return textRepresentations.map(parseResourceIdentifier);
}

export function newResourceIdentifierMap<V, TString extends string = string>(
    initialContents: Map<IResourceIdentifier<TString>, V> | Iterable<[IResourceIdentifier<TString>, V]>
        | ReadonlyArray<[IResourceIdentifier<TString>, V]> = []): IValidatedMap<IResourceIdentifier<TString>, V> {
    return new MapUsingProjection<IResourceIdentifier<TString>, V, string>(path => path.canonicalized, initialContents);
}
