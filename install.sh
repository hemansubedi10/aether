#!/usr/bin/env bash
#
# install.sh - Cross-platform installer for the Aether CLI (macOS / Linux)
#
# Usage:
#   bash install.sh            # interactive
#   bash install.sh --yes      # non-interactive
#
set -euo pipefail

REPO_URL="https://github.com/hemansubedi10/aether.git"
MIN_NODE_MAJOR=20
INSTALL_DIR="${AETHER_INSTALL_DIR:-$HOME/.aether}"
BIN_DIR="${AETHER_BIN_DIR:-$HOME/.local/bin}"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    -h|--help)
      echo "Usage: bash install.sh [--yes]"
      echo "Install the Aether CLI on macOS or Linux."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: bash install.sh [--yes]" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  *) die "Unsupported OS: $OS. install.sh supports macOS and Linux. Use install.ps1 on Windows." ;;
esac
say "Detected platform: $PLATFORM"

# ---------------------------------------------------------------------------
# Node.js check
# ---------------------------------------------------------------------------
need_node=0
if ! command -v node >/dev/null 2>&1; then
  need_node=1
else
  NODE_VERSION="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
  if [ -z "$NODE_VERSION" ]; then
    need_node=1
  elif [ "$NODE_VERSION" -lt "$MIN_NODE_MAJOR" ]; then
    warn "Node.js v$NODE_VERSION detected, but >= v$MIN_NODE_MAJOR is required."
    need_node=1
  fi
fi

if [ "$need_node" -eq 1 ]; then
  say "Node.js >= v$MIN_NODE_MAJOR not found."
  if [ "$YES" -eq 1 ]; then
    PROMPT="y"
  else
    printf 'Install Node.js now via your package manager? [Y/n] '
    read -r PROMPT
    PROMPT="${PROMPT:-y}"
  fi
  case "${PROMPT,,}" in
    y|yes)
      if command -v brew >/dev/null 2>&1; then
        say "Installing Node.js via Homebrew..."
        brew install node
      elif command -v apt-get >/dev/null 2>&1; then
        say "Installing Node.js via apt..."
        sudo apt-get update -y && sudo apt-get install -y nodejs npm
      elif command -v dnf >/dev/null 2>&1; then
        say "Installing Node.js via dnf..."
        sudo dnf install -y nodejs npm
      elif command -v pacman >/dev/null 2>&1; then
        say "Installing Node.js via pacman..."
        sudo pacman -S --noconfirm nodejs npm
      elif command -v zypper >/dev/null 2>&1; then
        say "Installing Node.js via zypper..."
        sudo zypper install -y nodejs npm
      else
        die "No supported package manager found. Install Node.js >= v$MIN_NODE_MAJOR manually from https://nodejs.org"
      fi
      ;;
    n|no)
      die "Node.js >= v$MIN_NODE_MAJOR is required. Install it manually from https://nodejs.org and re-run this script."
      ;;
    *)
      die "Invalid response. Aborting."
      ;;
  esac

  # Re-check after attempted install
  if ! command -v node >/dev/null 2>&1; then
    die "Node.js still not found after install attempt. Please install it manually."
  fi
  NODE_VERSION="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
  [ "$NODE_VERSION" -ge "$MIN_NODE_MAJOR" ] || die "Node.js version still too old (v$NODE_VERSION). Need >= v$MIN_NODE_MAJOR."
fi
say "Node.js $(node -v) detected."

# npm is required
command -v npm >/dev/null 2>&1 || die "npm not found. Node.js installation should include npm."

# ---------------------------------------------------------------------------
# Acquire the source
# ---------------------------------------------------------------------------
REPO_DIR="$INSTALL_DIR/repo"
if [ -d "$REPO_DIR" ] && [ -d "$REPO_DIR/.git" ]; then
  say "Updating existing checkout at $REPO_DIR ..."
  git -C "$REPO_DIR" fetch --depth=1 origin
  git -C "$REPO_DIR" reset --hard origin/main
  git -C "$REPO_DIR" clean -fd
elif [ -d "$REPO_DIR" ]; then
  say "Existing directory at $REPO_DIR is not a git repo. Removing it..."
  rm -rf "$REPO_DIR"
  say "Cloning $REPO_URL ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
else
  say "Cloning $REPO_URL ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
say "Installing npm dependencies..."
(cd "$REPO_DIR" && npm install --no-audit --no-fund)

# ---------------------------------------------------------------------------
# Build (TypeScript -> dist/)
# ---------------------------------------------------------------------------
if [ -f "$REPO_DIR/package.json" ] && grep -q '"build"' "$REPO_DIR/package.json"; then
  say "Building TypeScript..."
  (cd "$REPO_DIR" && npm run build) || warn "Build failed; the CLI will run via tsx instead."
fi

# ---------------------------------------------------------------------------
# Link the CLI onto PATH
# ---------------------------------------------------------------------------
mkdir -p "$BIN_DIR"
ln -sf "$REPO_DIR/src/index.ts" "$BIN_DIR/aether"
ln -sf "$REPO_DIR/src/server.ts" "$BIN_DIR/aether-server"

# Ensure bin dir is on PATH for this session and future shells
export PATH="$BIN_DIR:$PATH"
SHELL_RC=""
case "$SHELL" in
  */zsh)  SHELL_RC="$HOME/.zshrc" ;;
  */bash) SHELL_RC="$HOME/.bashrc" ;;
  *)      SHELL_RC="$HOME/.profile" ;;
esac
for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
  if [ -f "$rc" ] && ! grep -q "AETHER_BIN_DIR\|$BIN_DIR" "$rc" 2>/dev/null; then
    printf '\n# Aether CLI\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
    say "Added $BIN_DIR to PATH in $rc"
  fi
done

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
if command -v aether >/dev/null 2>&1; then
  say "Aether installed successfully."
  aether --version 2>/dev/null || true
  echo
  echo "Run it with:"
  echo "  aether \"your prompt here\""
  echo "  aether                 # interactive TUI"
  echo "  aether-server         # start HTTP server"
  echo
  echo "If 'aether' is not found, open a new terminal or run:"
  echo "  source ${SHELL_RC:-$HOME/.profile}"
else
  warn "Installation finished but 'aether' is not on PATH yet."
  warn "Open a new terminal, or run: source ${SHELL_RC:-$HOME/.profile}"
  echo
  echo "Then run:"
  echo "  aether --version"
fi
