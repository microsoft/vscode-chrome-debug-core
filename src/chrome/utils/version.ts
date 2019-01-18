/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as semver from 'semver';

export class Version {
    constructor(private readonly _semverVersion: semver.SemVer) { }

    public static coerce(versionString: string): Version {
        return new Version(semver.coerce(versionString));
    }

    public static unknownVersion(): Version {
        return Version.coerce('0.0.0'); // Using 0.0.0 will make behave isAtLeastVersion as if this was the oldest possible version
    }

    public isAtLeastVersion(versionToCompare: string): boolean {
        return semver.gte(this._semverVersion, versionToCompare);
    }
}
