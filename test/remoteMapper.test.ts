/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { URI } from 'vscode-uri';
import * as assert from 'assert';
import * as testUtils from './testUtils';
import { mapRemoteClientToInternalPath, mapInternalSourceToRemoteClient } from '../src/remoteMapper';
import { DebugProtocol } from 'vscode-debugprotocol';

const remotePathComponent = '__vscode-remote-uri__';

function getRemoteUri(pathPart: string): string {
    return URI.file(pathPart).with({
        scheme: 'vscode-remote',
        authority: 'foo+bar'
    }).toString();
}

suite('remoteMapper', () => {
    setup(() => {
        testUtils.setupUnhandledRejectionListener();
    });

    test('mapRemoteClientToInternalPath - positive', () => {
        assert.equal(mapRemoteClientToInternalPath('vscode-remote://foo/my/path'), `/${remotePathComponent}/my/path`);
        assert.equal(mapRemoteClientToInternalPath('vscode-remote://foo+bar/my/path'), `/${remotePathComponent}/my/path`);
        assert.equal(mapRemoteClientToInternalPath('vscode-remote://foo+bar/index.html'), `/${remotePathComponent}/index.html`);
        assert.equal(mapRemoteClientToInternalPath('vscode-remote://foo/my/path'), `/${remotePathComponent}/my/path`);

        assert.equal(mapRemoteClientToInternalPath(getRemoteUri('c:/my/path')), `c:\\${remotePathComponent}\\my\\path`);
        assert.equal(mapRemoteClientToInternalPath(getRemoteUri('c:\\my\\path')), `c:\\${remotePathComponent}\\my\\path`);
    });

    test('mapRemoteClientToInternalPath - negative', () => {
        assert.equal(mapRemoteClientToInternalPath('/foo/bar'), '/foo/bar');
        assert.equal(mapRemoteClientToInternalPath('/foo'), '/foo');
        assert.equal(mapRemoteClientToInternalPath('/'), '/');
        assert.equal(mapRemoteClientToInternalPath(`/foo/${remotePathComponent}`), `/foo/${remotePathComponent}`);

        assert.equal(mapRemoteClientToInternalPath('c:/'), 'c:/');
        assert.equal(mapRemoteClientToInternalPath('c:\\foo\\bar'), 'c:\\foo\\bar');
        assert.equal(mapRemoteClientToInternalPath(`c:\\foo\\bar\\${remotePathComponent}`), `c:\\foo\\bar\\${remotePathComponent}`);
    });

    test('mapInternalSourceToRemoteClient - positive', () => {
        function doTest(internalSource: string, authority: string, expectedUri: string): void {
            const dpSource: DebugProtocol.Source = {
                path: internalSource,
                origin: 'origin',
                sourceReference: 1
            };

            const mappedSource = mapInternalSourceToRemoteClient(dpSource, authority);
            assert.equal(mappedSource.path, expectedUri);
            assert.equal(mappedSource.origin, undefined);
            assert.equal(mappedSource.sourceReference, undefined);
        }

        doTest(`/${remotePathComponent}/my/path`, 'foo', 'vscode-remote://foo/my/path');
        doTest(`/${remotePathComponent}/mypath`, 'foo', 'vscode-remote://foo/mypath');
        doTest(`/${remotePathComponent}/my/path`, 'foo+bar', 'vscode-remote://foo%2Bbar/my/path');

        doTest(`c:/${remotePathComponent}/my/path`, 'foo', 'vscode-remote://foo/c%3A/my/path');
    });
});