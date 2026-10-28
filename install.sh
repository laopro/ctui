#!/usr/bin/env bash
# Untested on Linux/Mac — ctui has only run on Windows so far.
set -euo pipefail
INSTALL_DIR="$HOME/.ctui"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing install at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning ctui to $INSTALL_DIR"
  git clone --depth 1 https://github.com/laopro/ctui.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm install --no-fund --no-audit

BIN_DIR="$INSTALL_DIR/bin"
SHELL_RC="$HOME/.bashrc"
[ -n "${ZSH_VERSION:-}" ] && SHELL_RC="$HOME/.zshrc"

if ! grep -qs "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
  echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
  echo "Added $BIN_DIR to PATH in $SHELL_RC."
  echo "Run: source $SHELL_RC   (or open a new shell), then: ctui"
else
  echo "Installed. Run: ctui"
fi
