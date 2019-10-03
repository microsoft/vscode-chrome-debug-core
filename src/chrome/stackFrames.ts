/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { DebugProtocol } from 'vscode-debugprotocol';
import { Handles } from 'vscode-debugadapter';
import { IStackTraceResponseBody,
    IInternalStackTraceResponseBody } from '../debugAdapterInterfaces';
import { Protocol as Crdp } from 'devtools-protocol';
import { Transformers } from './chromeDebugAdapter';
import { ScriptContainer } from './scripts';
import { SmartStepper } from './smartStep';
import { ScriptSkipper } from './scriptSkipping';

import * as ChromeUtils from './chromeUtils';
import * as utils from '../utils';
import * as path from 'path';
import * as nls from 'vscode-nls';
import * as errors from '../errors';
import { VariablesManager } from './variablesManager';
import { ScopeContainer, ExceptionContainer } from './variables';

let localize = nls.loadMessageBundle();

export class StackFrames {

    private _frameHandles = new Handles<Crdp.Debugger.CallFrame>();

    constructor() {}

    /**
     * Clear the currently stored stack frames
     */
    reset() {
        this._frameHandles.reset();
    }

    /**
     * Get a stack frame by its id
     */
    getFrame(frameId: number) {
        return this._frameHandles.get(frameId);
    }

    public async getStackTrace({ args, scripts, originProvider, scriptSkipper, smartStepper, transformers, pauseEvent }:
                { args: DebugProtocol.StackTraceArguments;
                  scripts: ScriptContainer;
                  originProvider: (url: string) => string;
                  scriptSkipper: ScriptSkipper;
                  smartStepper: SmartStepper;
                  transformers: Transformers;
                  pauseEvent: Crdp.Debugger.PausedEvent; }): Promise<IStackTraceResponseBody> {

        let stackFrames = pauseEvent.callFrames.map(frame => this.callFrameToStackFrame(frame, scripts, originProvider))
            .concat(this.asyncFrames(pauseEvent.asyncStackTrace, scripts, originProvider));

        const totalFrames = stackFrames.length;
        if (typeof args.startFrame === 'number') {
            stackFrames = stackFrames.slice(args.startFrame);
        }

        if (typeof args.levels === 'number') {
            stackFrames = stackFrames.slice(0, args.levels);
        }

        const stackTraceResponse: IInternalStackTraceResponseBody = {
            stackFrames,
            totalFrames
        };
        await transformers.pathTransformer.stackTraceResponse(stackTraceResponse);
        await transformers.sourceMapTransformer.stackTraceResponse(stackTraceResponse);

        await Promise.all(stackTraceResponse.stackFrames.map(async (frame) => {
            // Remove isSourceMapped to convert back to DebugProtocol.StackFrame
            const isSourceMapped = frame.isSourceMapped;
            delete frame.isSourceMapped;

            if (!frame.source) {
                return;
            }

            // Apply hints to skipped frames
            const getSkipReason = reason => localize('skipReason', "(skipped by '{0}')", reason);
            if (frame.source.path && scriptSkipper.shouldSkipSource(frame.source.path)) {
                frame.source.origin = (frame.source.origin ? frame.source.origin + ' ' : '') + getSkipReason('skipFiles');
                frame.source.presentationHint = 'deemphasize';
            } else if (!isSourceMapped && await smartStepper.shouldSmartStep(frame, transformers.pathTransformer, transformers.sourceMapTransformer)) {
                // TODO !isSourceMapped is a bit of a hack here
                frame.source.origin = (frame.source.origin ? frame.source.origin + ' ' : '') + getSkipReason('smartStep');
                (<any>frame).presentationHint = 'deemphasize';
            }

            // Allow consumer to adjust final path
            if (frame.source.path && frame.source.sourceReference) {
                frame.source.path = scripts.realPathToDisplayPath(frame.source.path);
            }

            // And finally, remove the fake eval path and fix the name, if it was never resolved to a real path
            if (frame.source.path && ChromeUtils.isEvalScript(frame.source.path)) {
                frame.source.path = undefined;
                frame.source.name = scripts.displayNameForSourceReference(frame.source.sourceReference);
            }
        }));

        transformers.lineColTransformer.stackTraceResponse(stackTraceResponse);
        stackTraceResponse.stackFrames.forEach(frame => frame.name = this.formatStackFrameName(frame, args.format));

        return stackTraceResponse;
    }

    getScopes({ args, scripts, transformers, variables, pauseEvent, currentException }:
              { args: DebugProtocol.ScopesArguments;
                scripts: ScriptContainer;
                transformers: Transformers;
                variables: VariablesManager;
                pauseEvent: Crdp.Debugger.PausedEvent;
                currentException: any; }): { scopes: DebugProtocol.Scope[]; } {
        const currentFrame = this._frameHandles.get(args.frameId);
        if (!currentFrame || !currentFrame.location || !currentFrame.callFrameId) {
            throw errors.stackFrameNotValid();
        }

        if (!currentFrame.callFrameId) {
            return { scopes: [] };
        }

        const currentScript = scripts.getScriptById(currentFrame.location.scriptId);
        const currentScriptUrl = currentScript && currentScript.url;
        const currentScriptPath = (currentScriptUrl && transformers.pathTransformer.getClientPathFromTargetPath(currentScriptUrl)) || currentScriptUrl;

        const scopes = currentFrame.scopeChain.map((scope: Crdp.Debugger.Scope, i: number) => {
            // The first scope should include 'this'. Keep the RemoteObject reference for use by the variables request
            const thisObj = i === 0 && currentFrame.this;
            const returnValue = i === 0 && currentFrame.returnValue;
            const variablesReference = variables.createHandle(
                new ScopeContainer(currentFrame.callFrameId, i, scope.object.objectId, thisObj, returnValue));

            const resultScope = <DebugProtocol.Scope>{
                name: scope.type.substr(0, 1).toUpperCase() + scope.type.substr(1), // Take Chrome's scope, uppercase the first letter
                variablesReference,
                expensive: scope.type === 'global'
            };

            if (scope.startLocation && scope.endLocation) {
                resultScope.column = scope.startLocation.columnNumber;
                resultScope.line = scope.startLocation.lineNumber;
                resultScope.endColumn = scope.endLocation.columnNumber;
                resultScope.endLine = scope.endLocation.lineNumber;
            }

            return resultScope;
        });

        if (currentException && this.lookupFrameIndex(args.frameId, pauseEvent) === 0) {
            scopes.unshift(<DebugProtocol.Scope>{
                name: localize('scope.exception', 'Exception'),
                variablesReference: variables.createHandle(ExceptionContainer.create(currentException))
            });
        }

        const scopesResponse = { scopes };
        if (currentScriptPath) {
            transformers.sourceMapTransformer.scopesResponse(currentScriptPath, scopesResponse);
            transformers.lineColTransformer.scopeResponse(scopesResponse);
        }

        return scopesResponse;
    }

    public async mapCallFrame(frame: Crdp.Runtime.CallFrame, transformers: Transformers, scripts: ScriptContainer, originProvider: (url: string) => string ): Promise<DebugProtocol.StackFrame> {
        const debuggerCF = this.runtimeCFToDebuggerCF(frame);
        const stackFrame = this.callFrameToStackFrame(debuggerCF, scripts, originProvider);
        await transformers.pathTransformer.fixSource(stackFrame.source);
        await transformers.sourceMapTransformer.fixSourceLocation(stackFrame);
        transformers.lineColTransformer.convertDebuggerLocationToClient(stackFrame);
        return stackFrame;
    }

    // We parse stack trace from `formattedException`, source map it and return a new string
    public async mapFormattedException(formattedException: string, transformers: Transformers): Promise<string> {
        const exceptionLines = formattedException.split(/\r?\n/);

        for (let i = 0, len = exceptionLines.length; i < len; ++i) {
            const line = exceptionLines[i];
            const matches = line.match(/^\s+at (.*?)\s*\(?([^ ]+):(\d+):(\d+)\)?$/);

            if (!matches) continue;
            const linePath = matches[2];
            const lineNum = parseInt(matches[3], 10);
            const adjustedLineNum = lineNum - 1;
            const columnNum = parseInt(matches[4], 10);
            const clientPath = transformers.pathTransformer.getClientPathFromTargetPath(linePath);
            const mapped = await transformers.sourceMapTransformer.mapToAuthored(clientPath || linePath, adjustedLineNum, columnNum);

            if (mapped && mapped.source && utils.isNumber(mapped.line) && utils.isNumber(mapped.column) && utils.existsSync(mapped.source)) {
                transformers.lineColTransformer.mappedExceptionStack(mapped);
                exceptionLines[i] = exceptionLines[i].replace(
                    `${linePath}:${lineNum}:${columnNum}`,
                    `${mapped.source}:${mapped.line}:${mapped.column}`);
            } else if (clientPath && clientPath !== linePath) {
                const location = { line: adjustedLineNum, column: columnNum };
                transformers.lineColTransformer.mappedExceptionStack(location);
                exceptionLines[i] = exceptionLines[i].replace(
                    `${linePath}:${lineNum}:${columnNum}`,
                    `${clientPath}:${location.line}:${location.column}`);
            }
        }

        return exceptionLines.join('\n');
    }

    private asyncFrames(stackTrace: Crdp.Runtime.StackTrace, scripts: ScriptContainer, originProvider: (url: string) => string): DebugProtocol.StackFrame[] {
        if (stackTrace) {
            const frames = stackTrace.callFrames
                .map(frame => this.runtimeCFToDebuggerCF(frame))
                .map(frame => this.callFrameToStackFrame(frame, scripts, originProvider));

            frames.unshift({
                id: this._frameHandles.create(null),
                name: `[ ${stackTrace.description} ]`,
                source: undefined,
                line: undefined,
                column: undefined,
                presentationHint: 'label'
            });

            return frames.concat(this.asyncFrames(stackTrace.parent, scripts, originProvider));
        } else {
            return [];
        }
    }

    private runtimeCFToDebuggerCF(frame: Crdp.Runtime.CallFrame): Crdp.Debugger.CallFrame {
        return {
            callFrameId: undefined,
            scopeChain: undefined,
            this: undefined,
            location: {
                lineNumber: frame.lineNumber,
                columnNumber: frame.columnNumber,
                scriptId: frame.scriptId
            },
            url: frame.url,
            functionName: frame.functionName
        };
    }

    private formatStackFrameName(frame: DebugProtocol.StackFrame, formatArgs?: DebugProtocol.StackFrameFormat): string {
        let formattedName = frame.name;

        if (frame.source && formatArgs) {
            if (formatArgs.module) {
                formattedName += ` [${frame.source.name}]`;
            }

            if (formatArgs.line) {
                formattedName += ` Line ${frame.line}`;
            }
        }

        return formattedName;
    }

    public callFrameToStackFrame(frame: Crdp.Debugger.CallFrame, scripts: ScriptContainer, originProvider: (url: string) => string): DebugProtocol.StackFrame {
        const { location, functionName } = frame;
        const line = location.lineNumber;
        const column = location.columnNumber;
        const script = scripts.getScriptById(location.scriptId);

        try {
            // When the script has a url and isn't one we're ignoring, send the name and path fields. PathTransformer will
            // attempt to resolve it to a script in the workspace. Otherwise, send the name and sourceReference fields.
            const sourceReference = scripts.getSourceReferenceForScriptId(script.scriptId);
            const source: DebugProtocol.Source = {
                name: path.basename(script.url),
                path: script.url,
                sourceReference,
                origin: originProvider(script.url)
            };

            // If the frame doesn't have a function name, it's either an anonymous function
            // or eval script. If its source has a name, it's probably an anonymous function.
            const frameName = functionName || (script.url ? '(anonymous function)' : '(eval code)');
            return {
                id: this._frameHandles.create(frame),
                name: frameName,
                source,
                line,
                column
            };
        } catch (e) {
            // Some targets such as the iOS simulator behave badly and return nonsense callFrames.
            // In these cases, return a dummy stack frame
            const evalUnknown = `${ChromeUtils.EVAL_NAME_PREFIX}_Unknown`;
            return {
                id: this._frameHandles.create(<any>{ }),
                name: evalUnknown,
                source: { name: evalUnknown, path: evalUnknown },
                line,
                column
            };
        }
    }

    /**
     * Try to lookup the index of the frame with given ID. Returns -1 for async frames and unknown frames.
     */
    public lookupFrameIndex(frameId: number, pauseEvent: Crdp.Debugger.PausedEvent): number {
        const currentFrame = this._frameHandles.get(frameId);
        if (!currentFrame || !currentFrame.callFrameId || !pauseEvent) {
            return -1;
        }

        return pauseEvent.callFrames.findIndex(frame => frame.callFrameId === currentFrame.callFrameId);
    }
}