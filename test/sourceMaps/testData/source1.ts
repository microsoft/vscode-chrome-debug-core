/**
 * Test class A
 */
class A {
    private _x = 3;

    constructor(x: number) {
        this._x = x;
    }

    public method1(): number {
        let x = this._x;
        x++;
        return x;
    }

    public method2(): string {
        return 'blah';
    }
}