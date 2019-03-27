/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as semver from 'semver';
import { version } from 'punycode';

export class Version {
    constructor(private readonly _semverVersion: semver.SemVer) { }

    public static coerce(versionString: string): Version {
        const semVerOrNull = semver.coerce(versionString);
        if (semVerOrNull !== null) {
            return new Version(semVerOrNull);
        } else {
            throw new Error(`Couldn't parse a version number from ${versionString}`);
        }
    }

    public static unknownVersion(): Version {
        return Version.coerce('0.0.0'); // Using 0.0.0 will make behave isAtLeastVersion as if this was the oldest possible version
    }

    public isAtLeastVersion(versionToCompare: string): boolean {
        return semver.gte(this._semverVersion, versionToCompare);
    }
}
