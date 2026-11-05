#!/usr/bin/env bash
# Mail Tracker: one command from a fresh clone to your own deployed copy.
#
#   ./setup.sh             guided setup (about 10 minutes)
#   ./setup.sh --dry-run   walk through every step without creating or changing anything
#
# This checks the tools you need, installs dependencies, then hands over to the
# interactive setup in scripts/setup.mjs. Safe to run again at any time.
set -euo pipefail
cd "$(dirname "$0")"

bold=$'\033[1m'; dim=$'\033[2m'; red=$'\033[31m'; green=$'\033[32m'; reset=$'\033[0m'
ok() { printf '  %s✓%s %s\n' "$green" "$reset" "$1"; }
missing() {
  printf '\n  %s✗ %s is required.%s\n' "$red" "$1" "$reset"
  printf '    %s\n\n' "$2"
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

printf '\n%sMail Tracker setup%s %s· checking your tools%s\n\n' "$bold" "$reset" "$dim" "$reset"

if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == CYGWIN* ]]; then
  missing "macOS, Linux or WSL" "On Windows, run this inside WSL: https://learn.microsoft.com/windows/wsl/install"
fi

has node || missing "Node.js 20 or newer" "Install it from https://nodejs.org (macOS: brew install node)"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
(( node_major >= 20 )) || missing "Node.js 20 or newer (you have $(node -v))" "Update from https://nodejs.org (macOS: brew upgrade node)"
ok "Node.js $(node -v)"

if ! has pnpm; then
  printf '  %s…%s pnpm not found, enabling it through Corepack (ships with Node)\n' "$dim" "$reset"
  corepack enable pnpm >/dev/null 2>&1 || missing "pnpm 10" "Run: npm install -g pnpm@10   (or: sudo corepack enable pnpm)"
fi
ok "pnpm $(pnpm --version)"

has gcloud || missing "the Google Cloud CLI (gcloud)" "Install it from https://cloud.google.com/sdk/docs/install (macOS: brew install --cask google-cloud-sdk), then run ./setup.sh again."
ok "Google Cloud CLI $(gcloud --version 2>/dev/null | head -1 | awk '{print $NF}')"

printf '  %s…%s installing dependencies (first run takes a minute)\n' "$dim" "$reset"
if ! install_log="$(pnpm install --frozen-lockfile 2>&1)"; then
  printf '%s\n' "$install_log" | tail -20
  missing "a clean dependency install" "pnpm install failed; see the output above."
fi
ok "dependencies installed"

exec node scripts/setup.mjs "$@"
