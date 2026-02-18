#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=== Installing dependencies ==="
npm install

echo "=== Compiling TypeScript ==="
npx tsc -p ./

echo "=== Packaging VSIX ==="
mkdir -p dist
npx @vscode/vsce package --no-dependencies --allow-missing-repository -o dist/

VSIX=$(ls -t dist/*.vsix | head -1)
echo ""
echo "Done! Install with:"
echo "  code --install-extension $VSIX"
