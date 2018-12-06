export class AddSourceUriToExpession {
    private nextEvaluateScriptId = 0;

    public addURLIfMissing(expression: string): string {
        const sourceUrlPrefix = '\n//# sourceURL=';

        if (expression.indexOf(sourceUrlPrefix) < 0) {
            expression += `${sourceUrlPrefix}<debugger-internal>/${this._prefix}/id=${this.nextEvaluateScriptId++}`;
        }

        return expression;
    }

    constructor(private readonly _prefix: string) {}
}