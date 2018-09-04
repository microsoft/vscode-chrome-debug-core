export function zeroOrPositive(name: string, value: number) {
    if (value < 0) {
        breakWhileDebugging();
        throw new Error(`Expected ${name} to be either zero or a positive number and instead it was ${value}`);
    }
}

function breakWhileDebugging() {
    // TODO DIEGO: Add logic to turn this off in production
    // tslint:disable-next-line:no-debugger
    // debugger;
}