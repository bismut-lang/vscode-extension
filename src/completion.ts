/**
 * Completion provider — dot-triggered completion for compound types.
 */

import * as vscode from 'vscode';
import { BismutSymbol } from './analyzer';
import { SymbolCache } from './symbolCache';

export class BismutCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private cache: SymbolCache) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext,
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const filePath = document.uri.fsPath;

        // Dot-triggered completion
        if (context.triggerCharacter === '.') {
            return this.provideDotCompletion(document, position, filePath);
        }

        // General completion (keywords, types, symbols)
        return this.provideGeneralCompletion(document, position, filePath);
    }

    private provideDotCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        filePath: string,
    ): vscode.CompletionItem[] {
        // Get the text before the dot
        const lineText = document.lineAt(position.line).text;
        const beforeDot = lineText.substring(0, position.character - 1).trimEnd();

        // Extract the identifier before the dot
        const identMatch = beforeDot.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (!identMatch) {
            return [];
        }

        const varName = identMatch[1];

        // Resolve the type of the variable
        let typeName = this.cache.findVariableType(filePath, varName);

        // If not found as a variable, it might be a type name or module
        if (!typeName) {
            typeName = varName;
        }

        // Find all members of this type
        const members = this.cache.findMembers(typeName);
        if (members.length === 0) {
            // Try as an enum (enum variants have parent = enum name)
            const enumMembers = this.cache.findMembers(varName);
            if (enumMembers.length > 0) {
                return enumMembers.map((m) => this.symbolToCompletionItem(m));
            }
            return [];
        }

        return members
            .filter((m) => m.kind !== 'parameter') // Don't suggest parameters
            .map((m) => this.symbolToCompletionItem(m));
    }

    private provideGeneralCompletion(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        filePath: string,
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Add keywords
        for (const kw of KEYWORDS) {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            items.push(item);
        }

        // Add builtin types
        for (const ty of BUILTIN_TYPES) {
            const item = new vscode.CompletionItem(ty, vscode.CompletionItemKind.TypeParameter);
            items.push(item);
        }

        // Add builtin functions
        for (const fn of BUILTIN_FUNCTIONS) {
            const item = new vscode.CompletionItem(fn, vscode.CompletionItemKind.Function);
            items.push(item);
        }

        // Add symbols from current file analysis
        const symbols = this.cache.getSymbols(filePath);
        const seen = new Set<string>();

        for (const sym of symbols) {
            const simpleName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;

            // Skip if it has a parent (member) — those come via dot-completion
            if (sym.parent && sym.kind !== 'function') {
                continue;
            }

            // Skip duplicates
            if (seen.has(simpleName)) {
                continue;
            }
            seen.add(simpleName);

            // Skip internal/mangled names
            if (simpleName.includes('__')) {
                continue;
            }

            items.push(this.symbolToCompletionItem(sym));
        }

        return items;
    }

    private symbolToCompletionItem(sym: BismutSymbol): vscode.CompletionItem {
        const simpleName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
        const kind = completionKindMap[sym.kind] ?? vscode.CompletionItemKind.Variable;

        const item = new vscode.CompletionItem(simpleName, kind);
        item.detail = sym.detail || undefined;

        // Build documentation
        if (sym.doc && sym.kind !== 'field' && sym.kind !== 'parameter') {
            item.documentation = new vscode.MarkdownString(sym.doc);
        }

        // For functions/methods, add parentheses in the insert text
        if (sym.kind === 'function' || sym.kind === 'method') {
            item.insertText = new vscode.SnippetString(`${simpleName}($0)`);
            item.command = {
                command: 'editor.action.triggerParameterHints',
                title: 'Trigger Parameter Hints',
            };
        }

        return item;
    }
}

const completionKindMap: Record<string, vscode.CompletionItemKind> = {
    function: vscode.CompletionItemKind.Function,
    class: vscode.CompletionItemKind.Class,
    struct: vscode.CompletionItemKind.Struct,
    interface: vscode.CompletionItemKind.Interface,
    enum: vscode.CompletionItemKind.Enum,
    method: vscode.CompletionItemKind.Method,
    method_sig: vscode.CompletionItemKind.Method,
    field: vscode.CompletionItemKind.Field,
    variable: vscode.CompletionItemKind.Variable,
    constant: vscode.CompletionItemKind.Constant,
    parameter: vscode.CompletionItemKind.Variable,
    enum_variant: vscode.CompletionItemKind.EnumMember,
};

const KEYWORDS = [
    'def', 'end', 'class', 'struct', 'interface', 'enum', 'import', 'extern',
    'if', 'elif', 'else', 'while', 'for', 'in', 'return', 'break', 'continue',
    'const', 'static', 'not', 'and', 'or', 'is', 'as', 'self',
    'True', 'False', 'None',
];

const BUILTIN_TYPES = [
    'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
    'f32', 'f64', 'bool', 'str', 'void', 'List', 'Dict', 'Fn',
];

const BUILTIN_FUNCTIONS = [
    'print', 'format', 'len', 'append', 'get', 'set', 'put',
    'lookup', 'has', 'keys', 'range',
];
