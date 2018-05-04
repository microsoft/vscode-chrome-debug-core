/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Mock, It, IMock } from 'typemoq';

import { LineColTransformer } from '../../src/transformers/lineNumberTransformer';
import { BaseSourceMapTransformer } from '../../src/transformers/baseSourceMapTransformer';
import { UrlPathTransformer } from '../../src/transformers/urlPathTransformer';

export function getMockLineNumberTransformer(): IMock<LineColTransformer> {
    const mock = Mock.ofType(LineColTransformer);

    mock.setup(m => m.setBreakpoints(It.isAny()))
        .returns(args => args);

    return mock;
}

export function getMockSourceMapTransformer(): IMock<BaseSourceMapTransformer> {
    const mock = Mock.ofType(BaseSourceMapTransformer);
    mock.setup(m => m.setBreakpoints(It.isAny(), It.isAny()))
        .returns(args => args);

    // mock.setup(m => m.getGeneratedPathFromAuthoredPath(It.isAnyString()))
    //     .returns(somePath => Promise.resolve(''));

    mock.setup(m => m.mapToAuthored(It.isAnyString(), It.isAnyNumber(), It.isAnyNumber()))
        .returns(somePath => Promise.resolve(somePath));

    mock.setup(m => m.allSources(It.isAnyString()))
        .returns(() => Promise.resolve([]));

    return mock;
}

export function getMockPathTransformer(): IMock<UrlPathTransformer> {
    const mock = Mock.ofType(UrlPathTransformer);
    mock.setup(m => m.setBreakpoints(It.isAny()))
        .returns(args => args);

    mock.setup(m => m.getTargetPathFromClientPath(It.isAnyString()))
            .returns(somePath => somePath);

    return mock;
}
