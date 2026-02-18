// Bismut Language Extension — activation and provider registration.

import * as vscode from 'vscode';
import { BismutAnalyzer } from './analyzer';
import { SymbolCache } from './symbolCache';
import { BismutHoverProvider } from './hover';
import { BismutDefinitionProvider, BismutReferenceProvider, BismutDocumentSymbolProvider } from './definition';
import { BismutCompletionProvider } from './completion';
import { BismutEvaluatableExpressionProvider } from './debugEval';
import { BismutDebugTrackerFactory } from './debugTracker';
import { BismutRunner } from './runner';

const BISMUT_LANG_ID = 'bismut';
const BISMUT_SELECTOR: vscode.DocumentSelector = { language: BISMUT_LANG_ID, scheme: 'file' };

let outputChannel: vscode.OutputChannel;
let symbolCache: SymbolCache;
let runner: BismutRunner;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Bismut');
    context.subscriptions.push(outputChannel);

    const analyzer = new BismutAnalyzer(outputChannel);
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('bismut');
    context.subscriptions.push(diagnosticCollection);

    symbolCache = new SymbolCache(analyzer, diagnosticCollection, outputChannel);
    runner = new BismutRunner(outputChannel);

    // ─── Check for Bismut binary ─────────────────────────────────────

    const binaryOk = await analyzer.checkBinary();
    if (!binaryOk) {
        const action = await vscode.window.showWarningMessage(
            'Bismut compiler not found. Please set the path to the Bismut binary in the extension settings.',
            'Open Settings',
            'Dismiss',
        );
        if (action === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'bismut.compilerPath');
        }
    }

    // ─── Register providers ──────────────────────────────────────────

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(BISMUT_SELECTOR, new BismutHoverProvider(symbolCache)),
        vscode.languages.registerDefinitionProvider(BISMUT_SELECTOR, new BismutDefinitionProvider(symbolCache)),
        vscode.languages.registerReferenceProvider(BISMUT_SELECTOR, new BismutReferenceProvider(symbolCache)),
        vscode.languages.registerDocumentSymbolProvider(BISMUT_SELECTOR, new BismutDocumentSymbolProvider(symbolCache)),
        vscode.languages.registerEvaluatableExpressionProvider(BISMUT_SELECTOR, new BismutEvaluatableExpressionProvider()),
        vscode.languages.registerCompletionItemProvider(
            BISMUT_SELECTOR,
            new BismutCompletionProvider(symbolCache),
            '.', // Trigger on dot
        ),
    );

    // ─── Debug adapter tracker (filter temporaries from Variables panel) ─

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', new BismutDebugTrackerFactory()),
    );

    // ─── Register commands ───────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('bismut.run', () => runner.run()),
        vscode.commands.registerCommand('bismut.debug', () => runner.debug()),
        vscode.commands.registerCommand('bismut.build', () => runner.build()),
        vscode.commands.registerCommand('bismut.analyze', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === BISMUT_LANG_ID) {
                symbolCache.analyzeFile(editor.document.uri.fsPath);
            }
        }),
    );

    // ─── Analyze on open ─────────────────────────────────────────────

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (doc.languageId === BISMUT_LANG_ID && doc.uri.scheme === 'file') {
                symbolCache.analyzeFile(doc.uri.fsPath);
            }
        }),
    );

    // ─── Analyze on save ─────────────────────────────────────────────

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.languageId === BISMUT_LANG_ID && doc.uri.scheme === 'file') {
                const config = vscode.workspace.getConfiguration('bismut');
                if (config.get<boolean>('analyzeOnSave', true)) {
                    symbolCache.analyzeFile(doc.uri.fsPath);
                }
            }
        }),
    );

    // ─── Analyze on type (debounced) ─────────────────────────────────

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.languageId === BISMUT_LANG_ID && e.document.uri.scheme === 'file') {
                const config = vscode.workspace.getConfiguration('bismut');
                if (config.get<boolean>('analyzeOnType', true)) {
                    const delay = config.get<number>('analyzeDebounceMs', 800);
                    symbolCache.analyzeFileDebounced(e.document.uri.fsPath, delay);
                }
            }
        }),
    );

    // ─── Clear diagnostics on close ──────────────────────────────────

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            if (doc.languageId === BISMUT_LANG_ID) {
                diagnosticCollection.delete(doc.uri);
                symbolCache.clearFile(doc.uri.fsPath);
            }
        }),
    );

    // ─── Re-check binary when settings change ────────────────────────

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('bismut.compilerPath') || e.affectsConfiguration('bismut.compilerDir')) {
                // Re-analyze all open Bismut files
                for (const doc of vscode.workspace.textDocuments) {
                    if (doc.languageId === BISMUT_LANG_ID && doc.uri.scheme === 'file') {
                        symbolCache.analyzeFile(doc.uri.fsPath);
                    }
                }
            }
        }),
    );

    // ─── Analyze already-open files ──────────────────────────────────

    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === BISMUT_LANG_ID && doc.uri.scheme === 'file') {
            symbolCache.analyzeFile(doc.uri.fsPath);
        }
    }

    outputChannel.appendLine('[Bismut] Extension activated.');
}

export function deactivate(): void {
    symbolCache?.dispose();
    runner?.dispose();
}
