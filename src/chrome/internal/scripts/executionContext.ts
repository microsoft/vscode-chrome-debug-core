export interface IExecutionContext {
    isDestroyed(): boolean;
}

export class ExecutionContext implements IExecutionContext {
    private _isDestroyed = false;

    public isDestroyed(): boolean {
        return this._isDestroyed;
    }

    public markAsDestroyed(): void {
        if (this._isDestroyed === false) {
            this._isDestroyed = true;
        } else {
            throw new Error(`The execution context ${this} was already marked as destroyed`);
        }
    }
}