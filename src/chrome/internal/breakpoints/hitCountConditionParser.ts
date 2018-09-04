export type HitCountConditionFunction = (numHits: number) => boolean;

export class HitCountConditionParser {
    private readonly HIT_COUNT_CONDITION_PATTERN = /^(>|>=|=|<|<=|%)?\s*([0-9]+)$/;
    private patternMatches: RegExpExecArray | undefined;

    public parse(): HitCountConditionFunction {
        this.patternMatches = this.HIT_COUNT_CONDITION_PATTERN.exec(this._hitCountCondition.trim());
        if (this.patternMatches && this.patternMatches.length >= 3) {
            // eval safe because of the regex, and this is only a string that the current user will type in
            /* tslint:disable:no-function-constructor-with-string-args */
            const shouldPause: HitCountConditionFunction = <any>new Function('numHits', this.javaScriptCodeToEvaluateCondition());
            /* tslint:enable:no-function-constructor-with-string-args */
            return shouldPause;
        } else {
            throw new Error(`Didn't recognize <${this._hitCountCondition}> as a valid hit count condition`);
        }
    }

    constructor(private readonly _hitCountCondition: string) { }

    private javaScriptCodeToEvaluateCondition() {
        const operator = this.parseOperator();
        const value = this.parseValue();
        const javaScriptCode = operator === '%'
            ? `return (numHits % ${value}) === 0;`
            : `return numHits ${operator} ${value};`;
        return javaScriptCode;
    }

    private parseValue(): string {
        return this.patternMatches[2];
    }

    private parseOperator(): string {
        let op = this.patternMatches[1] || '>=';
        if (op === '=')
            op = '==';
        return op;
    }
}