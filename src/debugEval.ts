/**
 * EvaluatableExpressionProvider for Bismut debug sessions.
 *
 * The DebugAdapterTracker (debugTracker.ts) demangles variable names
 * in DAP responses and stores the original C name in `evaluateName`.
 * This provider matches the hovered Bismut identifier against the
 * demangled names and returns `evaluateName` for GDB evaluation.
 */

import * as vscode from 'vscode';

export class BismutEvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {

    async provideEvaluatableExpression(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.EvaluatableExpression | undefined> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return undefined;
        }

        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // Skip keywords
        if (KEYWORDS.has(word)) {
            return undefined;
        }

        // Skip member access (e.g., hovering on `field` in `obj.field`)
        const lineText = document.lineAt(position.line).text;
        const charBefore = wordRange.start.character > 0
            ? lineText[wordRange.start.character - 1]
            : '';
        if (charBefore === '.') {
            return undefined;
        }

        try {
            const evalName = await this.findEvalName(session, word, token);
            if (evalName) {
                return new vscode.EvaluatableExpression(wordRange, evalName);
            }
        } catch {
            // Fall through
        }

        return undefined;
    }

    /**
     * Query the debug frame's variables. The tracker has already demangled
     * names, so we match on `v.name === bismutName` and return `v.evaluateName`
     * (the original C name) for GDB evaluation.
     */
    private async findEvalName(
        session: vscode.DebugSession,
        bismutName: string,
        token: vscode.CancellationToken,
    ): Promise<string | undefined> {
        const threadsResp = await session.customRequest('threads');
        const threads: any[] = threadsResp?.threads;
        if (!threads?.length) {
            return undefined;
        }

        const threadId: number = threads[0].id;

        const stackResp = await session.customRequest('stackTrace', {
            threadId,
            startFrame: 0,
            levels: 1,
        });
        const frames: any[] = stackResp?.stackFrames;
        if (!frames?.length) {
            return undefined;
        }

        const frameId: number = frames[0].id;

        const scopesResp = await session.customRequest('scopes', { frameId });
        const scopes: any[] = scopesResp?.scopes;
        if (!scopes) {
            return undefined;
        }

        for (const scope of scopes) {
            if (token.isCancellationRequested) {
                return undefined;
            }
            if (scope.name === 'Registers') {
                continue;
            }

            try {
                const varsResp = await session.customRequest('variables', {
                    variablesReference: scope.variablesReference,
                });
                const variables: any[] = varsResp?.variables;
                if (!variables) {
                    continue;
                }

                for (const v of variables) {
                    // Match demangled name; use evaluateName (original C name) for eval
                    if (v.name === bismutName) {
                        return v.evaluateName || v.name;
                    }
                }
            } catch {
                continue;
            }
        }

        return undefined;
    }
}

const KEYWORDS = new Set([
    'def', 'class', 'struct', 'interface', 'enum', 'if', 'elif', 'else',
    'while', 'for', 'in', 'return', 'break', 'continue', 'import', 'extern',
    'const', 'static', 'and', 'or', 'not', 'is', 'as', 'True', 'False',
    'None', 'end', 'self', 'range', 'print', 'format', 'len', 'append',
    'get', 'set', 'put', 'lookup', 'has', 'keys',
]);

