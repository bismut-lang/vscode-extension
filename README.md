# Bismut Language Extension for VS Code

Language support for the [Bismut](https://bismut-lang.github.io/website/) programming language.

## Features

- **Syntax Highlighting** — full TextMate grammar for `.mut` files
- **Diagnostics** — real-time error and warning reporting with squiggly underlines
- **Hover Info** — type signatures, doc comments, and symbol kinds on hover
- **Go to Definition** — `Ctrl+Click` or `F12` to jump to definitions
- **Find References** — `Shift+F12` to find all usages of a symbol
- **Document Symbols** — `Ctrl+Shift+O` for outline view
- **Code Completion** — dot-triggered completion for class/struct members, plus keyword and symbol completion
- **Run Button** — play button in the editor title bar to run the current file

## Installation

Build the extension first:

```bash
./build.sh
```

This produces a `.vsix` file in `dist/`. Install it using any of these methods:

### From the command line

```bash
code --install-extension dist/bismut-lang-0.1.0.vsix
```

### From the VS Code UI

1. Open VS Code
2. `Ctrl+Shift+P` -> **Extensions: Install from VSIX...**
3. Navigate to `dist/` and select the `.vsix` file

### Drag and drop

Drag the `.vsix` file from your file manager into the VS Code Extensions sidebar.

## Requirements

- **Bismut compiler** binary (`bismut`) must be installed and accessible
- The compiler must support the `analyze` subcommand (v0.1+)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `bismut.compilerPath` | `""` | Path to the Bismut binary. If empty, `bismut` must be on PATH. |
| `bismut.compilerDir` | `""` | Compiler root directory (`--compiler-dir`). If empty, uses the binary's directory. |
| `bismut.analyzeOnSave` | `true` | Run analysis on file save. |
| `bismut.analyzeOnType` | `true` | Run analysis as you type (debounced). |
| `bismut.analyzeDebounceMs` | `800` | Debounce delay in ms for on-type analysis. |

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `Bismut: Run Current File` | `Ctrl+Shift+R` | Build and run the active `.mut` file |
| `Bismut: Build Current File` | — | Compile the active `.mut` file |
| `Bismut: Analyze Current File` | — | Run analysis and update diagnostics |

## How It Works

The extension calls `bismut analyze <file.mut>` which runs the full compiler pipeline
(preprocess -> parse -> resolve -> typecheck) without code generation, outputting JSON with
diagnostics and symbol information. This data drives all IDE features.
