const lineIndexSymbol = Symbol();
export type LineNumber = number & { [lineIndexSymbol]: true };

const columnIndexSymbol = Symbol();
export type ColumnNumber = number & { [columnIndexSymbol]: true };
