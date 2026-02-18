/**
 * Symbol cache — stores analysis results per file for fast provider lookups.
 */

import * as vscode from 'vscode';
import { AnalysisResult, BismutSymbol, BismutDiagnostic, BismutAnalyzer } from './analyzer';

export class SymbolCache {
    /** Per-file analysis results */
    private cache = new Map<string, AnalysisResult>();
    /** Per-file symbol index: symbol name -> symbols with that name */
    private nameIndex = new Map<string, Map<string, BismutSymbol[]>>();
    /** Global symbol index across all analyzed files */
    private globalSymbols = new Map<string, BismutSymbol[]>();

    private analyzer: BismutAnalyzer;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private outputChannel: vscode.OutputChannel;

    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private analyzing = new Set<string>();

    constructor(
        analyzer: BismutAnalyzer,
        diagnosticCollection: vscode.DiagnosticCollection,
        outputChannel: vscode.OutputChannel,
    ) {
        this.analyzer = analyzer;
        this.diagnosticCollection = diagnosticCollection;
        this.outputChannel = outputChannel;
    }

    async analyzeFile(filePath: string): Promise<AnalysisResult | null> {
        if (this.analyzing.has(filePath)) {
            return this.cache.get(filePath) ?? null;
        }

        this.analyzing.add(filePath);
        try {
            const result = await this.analyzer.analyze(filePath);
            if (result) {
                this.cache.set(filePath, result);
                this.buildIndex(filePath, result);
                this.publishDiagnostics(result);
            }
            return result;
        } finally {
            this.analyzing.delete(filePath);
        }
    }

    analyzeFileDebounced(filePath: string, delayMs: number): void {
        const existing = this.debounceTimers.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }
        this.debounceTimers.set(
            filePath,
            setTimeout(() => {
                this.debounceTimers.delete(filePath);
                this.analyzeFile(filePath);
            }, delayMs),
        );
    }

    getResult(filePath: string): AnalysisResult | null {
        return this.cache.get(filePath) ?? null;
    }

    getSymbols(filePath: string): BismutSymbol[] {
        return this.cache.get(filePath)?.symbols ?? [];
    }

    findSymbolsByName(name: string): BismutSymbol[] {
        return this.globalSymbols.get(name) ?? [];
    }

    // Prefers definition kinds over usages.
    findDefinition(name: string): BismutSymbol | null {
        const candidates = this.findSymbolsByName(name);
        if (candidates.length === 0) {
            return null;
        }

        // Prefer definition kinds
        const defKinds = new Set(['function', 'class', 'struct', 'interface', 'enum', 'method', 'field', 'variable', 'constant']);
        for (const sym of candidates) {
            if (defKinds.has(sym.kind)) {
                return sym;
            }
        }
        return candidates[0];
    }

    findMembers(typeName: string): BismutSymbol[] {
        const results: BismutSymbol[] = [];
        for (const [, result] of this.cache) {
            for (const sym of result.symbols) {
                if (sym.parent === typeName) {
                    results.push(sym);
                }
            }
        }
        return results;
    }

    findSymbolAt(filePath: string, line: number, col: number): BismutSymbol | null {
        const result = this.cache.get(filePath);
        if (!result) {
            return null;
        }

        // Find the closest symbol at or near this position
        let best: BismutSymbol | null = null;
        let bestDist = Infinity;

        for (const sym of result.symbols) {
            if (sym.file === filePath && sym.line === line) {
                const dist = Math.abs(sym.col - col);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = sym;
                }
            }
        }
        return best;
    }

    findVariableType(filePath: string, varName: string): string | null {
        const result = this.cache.get(filePath);
        if (!result) {
            return null;
        }

        for (const sym of result.symbols) {
            if (sym.kind === 'variable' || sym.kind === 'constant' || sym.kind === 'parameter' || sym.kind === 'field') {
                // Check the simple name (after the last dot)
                const simpleName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
                if (simpleName === varName && sym.detail) {
                    return sym.detail;
                }
            }
        }
        return null;
    }

    clearFile(filePath: string): void {
        this.cache.delete(filePath);
        this.nameIndex.delete(filePath);
        this.rebuildGlobalIndex();
    }

    clearAll(): void {
        this.cache.clear();
        this.nameIndex.clear();
        this.globalSymbols.clear();
        this.diagnosticCollection.clear();
    }

    dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    // ─── Private helpers ──────────────────────────────────────────────

    private buildIndex(filePath: string, result: AnalysisResult): void {
        const index = new Map<string, BismutSymbol[]>();
        for (const sym of result.symbols) {
            // Index by full name
            const existing = index.get(sym.name) ?? [];
            existing.push(sym);
            index.set(sym.name, existing);

            // Also index by simple name (after last dot)
            if (sym.name.includes('.')) {
                const simple = sym.name.split('.').pop()!;
                const simpleList = index.get(simple) ?? [];
                simpleList.push(sym);
                index.set(simple, simpleList);
            }
        }
        this.nameIndex.set(filePath, index);
        this.rebuildGlobalIndex();
    }

    private rebuildGlobalIndex(): void {
        this.globalSymbols.clear();
        for (const [, index] of this.nameIndex) {
            for (const [name, syms] of index) {
                const existing = this.globalSymbols.get(name) ?? [];
                existing.push(...syms);
                this.globalSymbols.set(name, existing);
            }
        }
    }

    private publishDiagnostics(result: AnalysisResult): void {
        // Group diagnostics by file
        const byFile = new Map<string, BismutDiagnostic[]>();
        for (const d of result.diagnostics) {
            const file = d.file || result.file;
            const list = byFile.get(file) ?? [];
            list.push(d);
            byFile.set(file, list);
        }

        // Clear old diagnostics for the analyzed file
        this.diagnosticCollection.delete(vscode.Uri.file(result.file));

        // Publish new diagnostics
        for (const [file, diags] of byFile) {
            const uri = vscode.Uri.file(file);
            const vsDiags = diags.map((d) => this.toVsDiagnostic(d));
            this.diagnosticCollection.set(uri, vsDiags);
        }
    }

    private toVsDiagnostic(d: BismutDiagnostic): vscode.Diagnostic {
        const line = Math.max(0, d.line - 1);
        const col = Math.max(0, d.col - 1);
        const span = Math.max(1, d.span);

        const range = new vscode.Range(line, col, line, col + span);
        const severity =
            d.severity === 'error'
                ? vscode.DiagnosticSeverity.Error
                : d.severity === 'warning'
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;

        const diag = new vscode.Diagnostic(range, d.message, severity);
        diag.source = 'bismut';
        return diag;
    }
}
