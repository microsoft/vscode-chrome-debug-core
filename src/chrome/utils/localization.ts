// import { LocalizeInfo, loadMessageBundle, config } from 'vscode-nls';
// let _localize = loadMessageBundle(); // Initialize to an unlocalized version until we know which locale to use

// // TODO DIEGO: Make sure this works

// export function localize(info: LocalizeInfo, message: string, ...args: (string | number | boolean | undefined | null)[]): string;
// export function localize(key: string, message: string, ...args: (string | number | boolean | undefined | null)[]): string;
// export function localize(infoOrKey: string | LocalizeInfo, message: string, ...args: (string | number | boolean | undefined | null)[]) {
//     if (typeof infoOrKey === 'string') { // The compiler doesn't like it if we just make a single call
//         return _localize(infoOrKey, message, ...args);
//     } else {
//         return _localize(infoOrKey, message, ...args);
//     }
// }

// export function setLocale(locale: string): void {
//     _localize = config({ locale: locale })(); // Replace with the proper locale
// }
