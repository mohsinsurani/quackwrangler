# Linux runner for the real-VS Code UI suite (npm run test:ui:linux).
# Installs desktop VS Code and a virtual display, then runs the same interaction suite used on macOS.
FROM node:22-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb xauth dbus-x11 ca-certificates curl gnupg \
      libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 libxkbfile1 libsecret-1-0 libxss1 \
      fonts-dejavu-core \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg \
 && echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
      > /etc/apt/sources.list.d/vscode.list \
 && apt-get update && apt-get install -y --no-install-recommends code \
 && rm -rf /var/lib/apt/lists/*

ENV QW_VSCODE_PATH=/usr/share/code/code \
    QW_UI_OUT=/tmp/qw-ui-suite \
    DONT_PROMPT_WSL_INSTALL=1
WORKDIR /work
