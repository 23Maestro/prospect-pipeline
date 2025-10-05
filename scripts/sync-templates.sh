#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$1"
TPL="/Users/singleton23/Raycast/.templates"
mkdir -p "$REPO_DIR/.github/workflows" "$REPO_DIR/.github/ISSUE_TEMPLATE" "$REPO_DIR/scripts"
cp -f "$TPL/github/workflows/"*.yml "$REPO_DIR/.github/workflows/" || true
cp -f "$TPL/github/ISSUE_TEMPLATE/"*.yml "$REPO_DIR/.github/ISSUE_TEMPLATE/" || true
cp -f "$TPL/github/dependabot.yml" "$REPO_DIR/.github/dependabot.yml" || true
cp -f "$TPL/config/eslint.config.js" "$REPO_DIR/eslint.config.js"
cp -f "$TPL/config/.prettierrc" "$REPO_DIR/.prettierrc"
cp -f "$TPL/config/tsconfig.base.json" "$REPO_DIR/tsconfig.json"
cp -f "$TPL/scripts/"* "$REPO_DIR/scripts/" || true
echo "Synced templates to $REPO_DIR"
