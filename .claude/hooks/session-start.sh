#!/bin/bash
# Installs Ultima's npm dependencies when a Claude Code cloud session starts, so
# `npm run typecheck`, `npm test` and `npm run build:web` work right away.
set -euo pipefail

# Only needed in Claude Code on the web; local machines manage their own installs.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# The Electron binary (~100 MB) is only needed to launch the desktop app. Skip it here;
# run `node node_modules/electron/install.js` later if a session needs to start Electron.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

# `npm install` (not `npm ci`) so the cached container state is reused between sessions.
npm install --no-audit --no-fund --loglevel=error
