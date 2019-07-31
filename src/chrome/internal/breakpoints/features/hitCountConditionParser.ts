/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

import { hasMatches } from '../../../utils/typedOperators';
import * as _ from 'lodash';

export type HitCountConditionFunction = (numHits: number) => boolean;

export class HitCountConditionParser {
    private readonly HIT_COUNT_CONDITION_PATTERN = /^(>|>=|=|<|<=|%)?\s*([0-9]+)$/;

    constructor(private readonly _hitCountCondition: string) { }

    public parse(): HitCountConditionFunction {
        const patternMatches = this.HIT_COUNT_CONDITION_PATTERN.exec(this._hitCountCondition.trim());
        if (hasMatches(patternMatches) && patternMatches.length >= 3) {
            // eval safe because of the regex, and this is only a string that the current user will type in
            // tslint:disable-next-line: function-constructor
            const shouldPause: HitCountConditionFunction = <any>new Function('numHits', this.javaScriptCodeToEvaluateCondition(patternMatches));
            return shouldPause;
        } else {
            throw new Error(localize('error.hitCountParser.unrecognizedCondition', "Didn't recognize <{0}> as a valid hit count condition", this._hitCountCondition));
        }
    }

    private javaScriptCodeToEvaluateCondition(patternMatches: RegExpExecArray) {
        const operator = this.parseOperator(patternMatches);
        const value = this.parseValue(patternMatches);
        const javaScriptCode = operator === '%'
            ? `return (numHits % ${value}) === 0;`
            : `return numHits ${operator} ${value};`;
        return javaScriptCode;
    }

    private parseValue(patternMatches: RegExpExecArray): string {
        return patternMatches[2];
    }

    private parseOperator(patternMatches: RegExpExecArray): string {
        let op = _.defaultTo(patternMatches[1], '>=');
        if (op === '=')
            op = '==';
        return op;
    }
}