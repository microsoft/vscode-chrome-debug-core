export function undefinedOnFailure<R>(operation: () => R): R | undefined {
    try {
        return operation();
    } catch (exception) {
        // TODO DIEGO: Report telemetry for this
        return undefined;
    }
}

export async function asyncUndefinedOnFailure<R>(operation: () => Promise<R>): Promise<R | undefined> {
    try {
        return await operation();
    } catch (exception) {
        // TODO DIEGO: Report telemetry for this
        return undefined;
    }
}