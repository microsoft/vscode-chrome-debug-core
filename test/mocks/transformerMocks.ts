/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Mock, It, IMock } from 'typemoq';

import { LineColTransformer } from '../../src/transformers/lineNumberTransformer';
import { BaseSourceMapTransformer } from '../../src/transformers/baseSourceMapTransformer';
import { UrlPathTransformer } from '../../src/transformers/urlPathTransformer';

export function getMockLineNumberTransformer(): IMock<LineColTransformer> {
    return Mock.ofType(LineColTransformer);
}

export function getMockSourceMapTransformer(): IMock<BaseSourceMapTransformer> {
    const mock = Mock.ofType(BaseSourceMapTransformer);
    mock.setup(m => m.setBreakpoints(It.isAny(), It.isAny()))
        .returns(() => true);

    mock.setup(m => m.getGeneratedPathFromAuthoredPath(It.isAnyString()))
        .returns(somePath => Promise.resolve(somePath));

    mock.setup(m => m.mapToAuthored(It.isAnyString(), It.isAnyNumber(), It.isAnyNumber()))
        .returns(somePath => Promise.resolve(somePath));

    return mock;
}

export function getMockPathTransformer(): IMock<UrlPathTransformer> {
    const mock = Mock.ofType(UrlPathTransformer);
    mock.setup(m => m.setBreakpoints(It.isAny()))
        .returns(() => true);

    mock.setup(m => m.getTargetPathFromClientPath(It.isAnyString()))
            .returns(somePath => somePath);

    return mock;
}
