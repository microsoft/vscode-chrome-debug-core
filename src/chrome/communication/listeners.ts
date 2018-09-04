type Callback<Args, Result> = (args: Args) => Result;

export class Listeners<Args, Result> {
    private readonly _listeners = [] as Callback<Args, Result>[];

    public add(listener: Callback<Args, Result>): void {
        this._listeners.push(listener);
    }

    public call(args: Args): Result[] {
        return this._listeners.map(listener => listener(args));
    }

    public hasListeners(): boolean {
        return this._listeners.length > 0;
    }
}