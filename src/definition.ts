/**
 * Go-to-definition and find-references providers.
 */

import * as vscode from 'vscode';
import { BismutSymbol } from './analyzer';
import { SymbolCache } from './symbolCache';

// ─── Go To Definition ────────────────────────────────────────────────

export class BismutDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private cache: SymbolCache) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.Definition> {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const filePath = document.uri.fsPath;

        // Check for member access: `expr.member` or `module.Name`
        const lineText = document.lineAt(position.line).text;
        const beforeWord = lineText.substring(0, wordRange.start.character);
        const dotMatch = beforeWord.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.$/);

        let sym: BismutSymbol | null = null;

        if (dotMatch) {
            const parentName = dotMatch[1];
            // Try to resolve the type of the parent variable
            const parentType = this.cache.findVariableType(filePath, parentName);
            if (parentType) {
                sym = this.cache.findDefinition(`${parentType}.${word}`);
            }
            if (!sym) {
                // Fallback: parent might be a type or module name
                sym = this.cache.findDefinition(`${parentName}.${word}`);
            }
        }

        if (!sym) {
            sym = this.cache.findDefinition(word);
        }

        if (!sym || !sym.file || sym.line <= 0) {
            return null;
        }

        const uri = vscode.Uri.file(sym.file);
        const pos = new vscode.Position(sym.line - 1, Math.max(0, sym.col - 1));
        return new vscode.Location(uri, pos);
    }
}

// ─── Find References ─────────────────────────────────────────────────

export class BismutReferenceProvider implements vscode.ReferenceProvider {
    constructor(private cache: SymbolCache) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.Location[]> {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return [];
        }

        const word = document.getText(wordRange);
        const locations: vscode.Location[] = [];

        // Include the definition itself if requested
        if (context.includeDeclaration) {
            const sym = this.cache.findDefinition(word);
            if (sym && sym.file && sym.line > 0) {
                locations.push(
                    new vscode.Location(
                        vscode.Uri.file(sym.file),
                        new vscode.Position(sym.line - 1, Math.max(0, sym.col - 1)),
                    ),
                );
            }
        }

        // Text search for references in all open .mut files
        // This is approximate but works well for most cases
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return locations;
        }

        const mutFiles = await vscode.workspace.findFiles('**/*.mut', '**/node_modules/**', 200);
        const wordRegex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');

        for (const uri of mutFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const text = doc.getText();
                const lines = text.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    let match: RegExpExecArray | null;
                    wordRegex.lastIndex = 0;
                    while ((match = wordRegex.exec(lines[i])) !== null) {
                        // Skip if this is the definition position and not included
                        const loc = new vscode.Location(uri, new vscode.Position(i, match.index));
                        // Avoid duplicates with the definition
                        const isDuplicate = locations.some(
                            (l) =>
                                l.uri.fsPath === uri.fsPath &&
                                l.range.start.line === i &&
                                l.range.start.character === match!.index,
                        );
                        if (!isDuplicate) {
                            locations.push(loc);
                        }
                    }
                }
            } catch {
                // Skip files that can't be opened
            }
        }

        return locations;
    }
}

// ─── Document Symbol Provider ─────────────────────────────────────────

export class BismutDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    constructor(private cache: SymbolCache) {}

    provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const filePath = document.uri.fsPath;
        const allSymbols = this.cache.getSymbols(filePath);

        // Filter to symbols in this file, and only top-level + members
        const fileSymbols = allSymbols.filter((s) => s.file === filePath);

        // Build a tree: top-level symbols contain their members
        const topLevel: vscode.DocumentSymbol[] = [];
        const topLevelMap = new Map<string, vscode.DocumentSymbol>();

        // First pass: create top-level symbols
        for (const sym of fileSymbols) {
            if (!sym.parent) {
                const vsSymbol = this.toDocumentSymbol(sym, document);
                if (vsSymbol) {
                    topLevel.push(vsSymbol);
                    topLevelMap.set(sym.name, vsSymbol);
                }
            }
        }

        // Second pass: attach members to parents
        for (const sym of fileSymbols) {
            if (sym.parent) {
                const parent = topLevelMap.get(sym.parent);
                if (parent) {
                    const vsSymbol = this.toDocumentSymbol(sym, document);
                    if (vsSymbol) {
                        parent.children.push(vsSymbol);
                    }
                }
            }
        }

        return topLevel;
    }

    private toDocumentSymbol(
        sym: { name: string; kind: string; line: number; col: number; detail: string },
        document: vscode.TextDocument,
    ): vscode.DocumentSymbol | null {
        if (sym.line <= 0) {
            return null;
        }

        const simpleName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
        const line = sym.line - 1;
        const col = Math.max(0, sym.col - 1);
        const pos = new vscode.Position(line, col);
        const range = new vscode.Range(pos, new vscode.Position(line, col + simpleName.length));

        const kind = symbolKindMap[sym.kind] ?? vscode.SymbolKind.Variable;

        return new vscode.DocumentSymbol(
            simpleName,
            sym.detail || '',
            kind,
            range,
            range,
        );
    }
}

const symbolKindMap: Record<string, vscode.SymbolKind> = {
    function: vscode.SymbolKind.Function,
    class: vscode.SymbolKind.Class,
    struct: vscode.SymbolKind.Struct,
    interface: vscode.SymbolKind.Interface,
    enum: vscode.SymbolKind.Enum,
    method: vscode.SymbolKind.Method,
    method_sig: vscode.SymbolKind.Method,
    field: vscode.SymbolKind.Field,
    variable: vscode.SymbolKind.Variable,
    constant: vscode.SymbolKind.Constant,
    parameter: vscode.SymbolKind.Variable,
    enum_variant: vscode.SymbolKind.EnumMember,
};

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
