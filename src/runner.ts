/**
 * Run/build/debug commands for Bismut files.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';

export class BismutRunner {
    private outputChannel: vscode.OutputChannel;
    private runTerminal: vscode.Terminal | undefined;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async build(): Promise<void> {
        await this.execute('build', []);
    }

    async run(): Promise<void> {
        await this.execute('run', []);
    }

    /**
     * Debug the current file:
     * 1. Build with debug info: `bismut build <file.mut>`
     * 2. Launch a cppdbg (GDB) debug session on the resulting binary.
     */
    async debug(): Promise<void> {
        const filePath = this.getActiveFilePath();
        if (!filePath) {
            return;
        }

        const { binary, compilerDir } = this.getConfig();
        if (!binary) {
            return;
        }

        // Determine output binary path: same dir as source, stem of filename
        const sourceDir = path.dirname(filePath);
        const stem = path.basename(filePath, '.mut');
        const outputBinary = path.join(sourceDir, stem);

        // Build with debug info
        const buildArgs = ['build', filePath, '-o', outputBinary];
        if (compilerDir) {
            buildArgs.push('--compiler-dir', compilerDir);
        }

        this.outputChannel.appendLine(`Building: ${binary} ${buildArgs.join(' ')}`);

        const buildOk = await new Promise<boolean>((resolve) => {
            execFile(binary, buildArgs, { timeout: 60000 }, (error, stdout, stderr) => {
                if (stdout) { this.outputChannel.appendLine(stdout); }
                if (stderr) { this.outputChannel.appendLine(stderr); }
                if (error) {
                    vscode.window.showErrorMessage(`Bismut build failed: ${stderr || error.message}`);
                    this.outputChannel.show(true);
                    resolve(false);
                } else {
                    this.outputChannel.appendLine(`Build succeeded: ${outputBinary}`);
                    resolve(true);
                }
            });
        });

        if (!buildOk) {
            return;
        }

        // Stop any existing debug session before starting a new one
        if (vscode.debug.activeDebugSession) {
            await vscode.debug.stopDebugging();
            // Give a moment for cleanup
            await new Promise((r) => setTimeout(r, 300));
        }

        // Resolve path to GDB pretty-printer script bundled with extension
        const gdbPrettyScript = path.join(__dirname, '..', 'gdb', 'bismut_pretty.py');

        // Launch GDB debug session via cppdbg
        const debugConfig: vscode.DebugConfiguration = {
            type: 'cppdbg',
            name: `Debug ${stem}`,
            request: 'launch',
            program: outputBinary,
            args: [],
            cwd: sourceDir,
            stopAtEntry: false,
            externalConsole: false,
            MIMode: 'gdb',
            setupCommands: [
                {
                    description: 'Enable pretty-printing',
                    text: '-enable-pretty-printing',
                    ignoreFailures: true,
                },
                {
                    description: 'Load Bismut pretty-printers',
                    text: `-interpreter-exec console "source ${gdbPrettyScript}"`,
                    ignoreFailures: true,
                },
            ],
        };

        const folder = vscode.workspace.workspaceFolders?.[0];
        const started = await vscode.debug.startDebugging(folder, debugConfig);
        if (!started) {
            vscode.window.showErrorMessage(
                'Failed to start debug session. Make sure the C/C++ extension (ms-vscode.cpptools) is installed.',
            );
        }
    }

    private async execute(subcommand: string, extraArgs: string[]): Promise<void> {
        const filePath = this.getActiveFilePath();
        if (!filePath) {
            return;
        }

        const { binary, compilerDir } = this.getConfig();
        if (!binary) {
            return;
        }

        const args = [subcommand, filePath, ...extraArgs];
        if (compilerDir) {
            args.push('--compiler-dir', compilerDir);
        }

        const terminal = this.getTerminal();
        const cmd = this.buildCommand(binary, args);
        terminal.sendText(cmd);
        terminal.show(true);
    }

    private getActiveFilePath(): string | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'bismut') {
            vscode.window.showWarningMessage('No active Bismut file.');
            return null;
        }

        // Save the file before running
        if (editor.document.isDirty) {
            editor.document.save();
        }

        return editor.document.uri.fsPath;
    }

    private getConfig(): { binary: string | null; compilerDir: string } {
        const config = vscode.workspace.getConfiguration('bismut');
        const binary = config.get<string>('compilerPath', '') || 'bismut';
        const compilerDir = config.get<string>('compilerDir', '');

        // Only pass --compiler-dir if the user explicitly set it.
        // The compiler auto-detects from its own binary location.
        return { binary, compilerDir };
    }

    private getTerminal(): vscode.Terminal {
        // Reuse an existing terminal if it's still alive
        if (this.runTerminal) {
            const allTerminals = vscode.window.terminals;
            if (allTerminals.includes(this.runTerminal)) {
                return this.runTerminal;
            }
        }

        this.runTerminal = vscode.window.createTerminal({
            name: 'Bismut',
            iconPath: new vscode.ThemeIcon('play'),
        });

        return this.runTerminal;
    }

    private buildCommand(binary: string, args: string[]): string {
        // Shell-quote arguments that might contain spaces
        const parts = [binary, ...args].map((a) =>
            a.includes(' ') ? `"${a}"` : a,
        );
        return parts.join(' ');
    }

    dispose(): void {
        this.runTerminal?.dispose();
    }
}
