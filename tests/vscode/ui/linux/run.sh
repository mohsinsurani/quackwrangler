#!/usr/bin/env bash
# Runs the real-VS Code UI suite inside Linux (Docker + virtual display).
# Usage: npm run test:ui:linux [-- "<theme>" [width]]
set -euo pipefail
cd "$(dirname "$0")/../../../.."

# QW_UI_PLATFORM=linux/amd64 runs the x64 build under emulation (slower).
PLATFORM="${QW_UI_PLATFORM:-}"
TAG="qw-ui-linux${PLATFORM:+-${PLATFORM//\//-}}"
docker build -q ${PLATFORM:+--platform "$PLATFORM"} -t "$TAG" tests/vscode/ui/linux >/dev/null

# Copy the source into the container and install Linux-native dependencies there, so the
# macOS node_modules (with a darwin DuckDB binary) are never used on Linux.
docker run --rm --init --shm-size=1g ${PLATFORM:+--platform "$PLATFORM"} \
  -v "$PWD":/src:ro \
  "$TAG" bash -lc '
    set -e
    mkdir -p /work && cd /src
    tar --exclude=./node_modules --exclude=./webview-ui/node_modules --exclude=./.vscode-test \
        --exclude=./dist --exclude=./coverage --exclude=./.git -cf - . | tar -xf - -C /work
    cd /work
    npm ci --include=optional --no-audit --no-fund >/dev/null
    npm --prefix webview-ui ci --no-audit --no-fund >/dev/null
    npm run build >/dev/null
    # VS Code needs a session bus and a display; run as the suite expects.
    export QW_VSCODE_ARGS="--no-sandbox --disable-gpu --disable-dev-shm-usage"
    dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" node tests/vscode/ui/run-all.mjs "$@"
  ' _ "$@"
