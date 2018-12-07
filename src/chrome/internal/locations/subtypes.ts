// We use these types to have the compiler check that we are not sending a ColumnNumber where a LineNumber is expected

const lineIndexSymbol = Symbol();
export type LineNumber = number & { [lineIndexSymbol]: true };

const columnIndexSymbol = Symbol();
export type ColumnNumber = number & { [columnIndexSymbol]: true };
