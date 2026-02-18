/**
 * Bismut Analyzer — runs `bismut analyze` and parses the JSON output.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

// ─── Types matching the analyzer JSON output ─────────────────────────

export interface BismutDiagnostic {
    severity: 'error' | 'warning' | 'note';
    file: string;
    line: number;
    col: number;
    span: number;
    message: string;
}

export interface BismutSymbol {
    name: string;
    kind: string;
    file: string;
    line: number;
    col: number;
    doc: string;
    detail: string;
    parent: string;
}

export interface AnalysisResult {
    success: boolean;
    file: string;
    error_count: number;
    warning_count: number;
    diagnostics: BismutDiagnostic[];
    symbols: BismutSymbol[];
}

// ─── Analyzer class ─────────────────────────────────────────────────

export class BismutAnalyzer {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    getBinaryPath(): string | null {
        const config = vscode.workspace.getConfiguration('bismut');
        const configPath = config.get<string>('compilerPath', '');
        if (configPath) {
            return configPath;
        }
        // Try 'bismut' on PATH
        return 'bismut';
    }

    getCompilerDir(): string {
        const config = vscode.workspace.getConfiguration('bismut');
        // Only pass --compiler-dir if the user explicitly set it.
        // The compiler auto-detects from its own binary location.
        return config.get<string>('compilerDir', '');
    }

    async analyze(filePath: string): Promise<AnalysisResult | null> {
        const binary = this.getBinaryPath();
        if (!binary) {
            return null;
        }

        const compilerDir = this.getCompilerDir();
        const args = ['analyze', filePath];
        if (compilerDir) {
            args.push('--compiler-dir', compilerDir);
        }

        return new Promise((resolve) => {
            const options: cp.SpawnOptions = {
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                env: { ...process.env },
            };

            let stdout = '';
            let stderr = '';

            const proc = cp.spawn(binary, args, options);
            if (!proc.pid) {
                this.outputChannel.appendLine(`[Bismut] Failed to start: ${binary}`);
                resolve(null);
                return;
            }

            proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('error', (err: Error) => {
                this.outputChannel.appendLine(`[Bismut] Process error: ${err.message}`);
                resolve(null);
            });

            proc.on('close', (_code: number | null) => {
                if (stderr) {
                    // Stderr may contain EXTERN_FLAGS or warnings — log but don't fail
                    this.outputChannel.appendLine(`[Bismut] stderr: ${stderr.trim()}`);
                }

                if (!stdout.trim()) {
                    resolve(null);
                    return;
                }

                try {
                    const result = JSON.parse(stdout) as AnalysisResult;
                    resolve(result);
                } catch (e) {
                    this.outputChannel.appendLine(`[Bismut] Failed to parse JSON: ${(e as Error).message}`);
                    this.outputChannel.appendLine(`[Bismut] Raw output: ${stdout.substring(0, 500)}`);
                    resolve(null);
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                proc.kill();
                resolve(null);
            }, 30000);
        });
    }

    async checkBinary(): Promise<boolean> {
        const binary = this.getBinaryPath();
        if (!binary) {
            return false;
        }

        return new Promise((resolve) => {
            const proc = cp.spawn(binary, ['--help'], {
                env: { ...process.env },
            });

            proc.on('error', () => resolve(false));
            proc.on('close', (code) => resolve(code !== null));

            setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 5000);
        });
    }
}
