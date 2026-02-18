/**
 * Hover provider — shows type, signature, kind, and doc comments on hover.
 */

import * as vscode from 'vscode';
import { BismutSymbol } from './analyzer';
import { SymbolCache } from './symbolCache';

export class BismutHoverProvider implements vscode.HoverProvider {
    constructor(private cache: SymbolCache) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.Hover> {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const filePath = document.uri.fsPath;

        // Check for member access: `expr.member`
        const lineText = document.lineAt(position.line).text;
        const beforeWord = lineText.substring(0, wordRange.start.character);
        const dotMatch = beforeWord.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.$/);

        let symbols: BismutSymbol[] = [];

        if (dotMatch) {
            const parentName = dotMatch[1];
            // Try to resolve the type of the parent
            const parentType = this.resolveType(filePath, parentName);
            if (parentType) {
                // Look for `TypeName.member`
                const qualifiedName = `${parentType}.${word}`;
                symbols = this.cache.findSymbolsByName(qualifiedName);
            }
            if (symbols.length === 0) {
                // Fallback: try parent as a module or type name directly
                const qualifiedName = `${parentName}.${word}`;
                symbols = this.cache.findSymbolsByName(qualifiedName);
            }
        }

        if (symbols.length === 0) {
            symbols = this.cache.findSymbolsByName(word);
        }

        if (symbols.length === 0) {
            return null;
        }

        // Pick the best match — prefer definitions
        const sym = this.pickBestSymbol(symbols);
        if (!sym) {
            return null;
        }

        const md = this.buildHoverContent(sym);
        return new vscode.Hover(md, wordRange);
    }

    private resolveType(filePath: string, varName: string): string | null {
        return this.cache.findVariableType(filePath, varName);
    }

    private pickBestSymbol(symbols: BismutSymbol[]): BismutSymbol | null {
        const priority: Record<string, number> = {
            function: 1,
            class: 2,
            struct: 3,
            interface: 4,
            enum: 5,
            method: 6,
            field: 7,
            constant: 8,
            variable: 9,
            method_sig: 10,
            enum_variant: 11,
            parameter: 12,
        };

        symbols.sort((a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99));
        return symbols[0] ?? null;
    }

    private buildHoverContent(sym: BismutSymbol): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        // Build the signature / type header
        const header = this.buildHeader(sym);
        md.appendCodeblock(header, 'bismut');

        // Show kind
        md.appendMarkdown(`\n**${sym.kind}**`);

        // Show doc comment if present
        if (sym.doc && sym.kind !== 'field' && sym.kind !== 'parameter') {
            md.appendMarkdown(`\n\n---\n\n${sym.doc}`);
        }

        return md;
    }

    private buildHeader(sym: BismutSymbol): string {
        switch (sym.kind) {
            case 'function':
                return `def ${sym.name}${sym.detail}`;
            case 'method': {
                const methodName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
                const parentPrefix = sym.parent ? `${sym.parent}.` : '';
                return `def ${parentPrefix}${methodName}${sym.detail}`;
            }
            case 'method_sig': {
                const sigName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
                return `def ${sigName}(...)`;
            }
            case 'class':
                return `class ${sym.name}`;
            case 'struct':
                return `struct ${sym.name}`;
            case 'interface':
                return `interface ${sym.name}`;
            case 'enum':
                return `enum ${sym.name}`;
            case 'field': {
                const fieldName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
                return `${fieldName}: ${sym.detail || sym.doc || '???'}`;
            }
            case 'variable':
                return `${sym.name}: ${sym.detail || '???'}`;
            case 'constant':
                return `const ${sym.name}: ${sym.detail || '???'}`;
            case 'parameter': {
                const paramName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
                return `${paramName}: ${sym.detail || sym.doc || '???'}`;
            }
            case 'enum_variant': {
                return sym.name;
            }
            default:
                return sym.name;
        }
    }
}
