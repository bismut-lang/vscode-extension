/**
 * DebugAdapterTracker that cleans up the Variables panel for Bismut
 * debug sessions:
 *
 * 1. Filters out compiler temporaries (_t1, _t2, …)
 * 2. Demangles variable names: `count_3` → `count`, `x_` → `x`
 * 3. Hides internal runtime symbols (__lang_rt_*, __clib__*)
 *
 * Works by mutating DAP 'variables' responses in-place before VS Code
 * processes them.
 */

import * as vscode from 'vscode';

/** Compiler temporaries: _t followed by digits */
const TEMP_RE = /^_t\d+$/;
/** Internal runtime / library symbols */
const INTERNAL_RE = /^__lang_rt_|^__clib__|^__LANG_RT_/;
/** Mangling suffix: trailing _ optionally followed by digits */
const MANGLE_SUFFIX_RE = /_\d*$/;

export class BismutDebugTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    createDebugAdapterTracker(
        _session: vscode.DebugSession,
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return new BismutDebugTracker();
    }
}

class BismutDebugTracker implements vscode.DebugAdapterTracker {
    onDidSendMessage(message: any): void {
        if (
            message.type === 'response' &&
            message.command === 'variables' &&
            message.success &&
            message.body?.variables
        ) {
            message.body.variables = message.body.variables
                .filter((v: any) => {
                    const name: string = v.name;
                    // Hide temporaries
                    if (TEMP_RE.test(name)) { return false; }
                    // Hide runtime internals
                    if (INTERNAL_RE.test(name)) { return false; }
                    return true;
                })
                .map((v: any) => {
                    const name: string = v.name;
                    // Don't demangle names starting with __ (internals that survived filter)
                    if (name.startsWith('__')) { return v; }
                    // Strip mangling suffix: name_7 → name, x_ → x
                    const demangled = name.replace(MANGLE_SUFFIX_RE, '');
                    if (demangled.length > 0 && demangled !== name) {
                        v.name = demangled;
                        // Keep the C name in evaluateName so GDB can still evaluate it
                        if (!v.evaluateName) {
                            v.evaluateName = name;
                        }
                    }
                    return v;
                });
        }
    }
}

