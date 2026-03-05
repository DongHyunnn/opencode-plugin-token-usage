#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/DongHyunnn/opencode-plugin-token-usage.git"
PLUGIN_DIR="$HOME/.config/opencode/plugins/opencode-plugin-token-usage"
CONFIG_FILE="$HOME/.config/opencode/opencode.json"
PLUGIN_ENTRY="./plugins/opencode-plugin-token-usage"

# ── Colors ────────────────────────────────────────────────────────────
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()    { echo -e "${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "${YELLOW}!${RESET}  $*"; }
error()   { echo -e "${RED}✗${RESET}  $*" >&2; exit 1; }

# ── 1. Require git ────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || error "git is required but not installed."
command -v node >/dev/null 2>&1 || error "node is required but not installed."

# ── 2. Clone or update plugin ─────────────────────────────────────────
mkdir -p "$(dirname "$PLUGIN_DIR")"

if [ -d "$PLUGIN_DIR/.git" ]; then
  info "Plugin already installed — pulling latest..."
  git -C "$PLUGIN_DIR" pull --rebase origin main
else
  info "Cloning plugin..."
  git clone --depth=1 "$REPO_URL" "$PLUGIN_DIR"
fi

# ── 3. Patch opencode.json ────────────────────────────────────────────
mkdir -p "$(dirname "$CONFIG_FILE")"

# Create opencode.json if it doesn't exist
if [ ! -f "$CONFIG_FILE" ]; then
  echo '{}' > "$CONFIG_FILE"
  info "Created $CONFIG_FILE"
fi

# Use node to safely patch the JSON (handles existing plugin array, avoids duplicates)
node --input-type=module <<EOF
import { readFileSync, writeFileSync } from "node:fs";

const path = "$CONFIG_FILE";
const entry = "$PLUGIN_ENTRY";

let config;
try {
  config = JSON.parse(readFileSync(path, "utf8"));
} catch {
  config = {};
}

if (!Array.isArray(config.plugin)) {
  config.plugin = [];
}

if (config.plugin.includes(entry)) {
  console.log("  Plugin entry already present in opencode.json — skipping.");
} else {
  config.plugin.push(entry);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log("  Added plugin entry to opencode.json.");
}
EOF

# ── 4. Done ───────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}⚡ opencode-plugin-token-usage installed!${RESET}"
echo ""
echo "  Plugin:  $PLUGIN_DIR"
echo "  Config:  $CONFIG_FILE"
echo ""
echo "  Restart OpenCode to activate."
echo "  Sign in with: opencode auth login"
echo ""
