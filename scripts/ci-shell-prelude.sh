#!/usr/bin/env bash
# ci-shell-prelude.sh — mandatory prefix for every shell command (promotion
# guide §12.2). Source this file at the top of any guide/CI/recovery shell:
#
#   set -euo pipefail
#   source "$(git rev-parse --show-toplevel)/scripts/ci-shell-prelude.sh"
#
# It enforces `set -euo pipefail`, resolves and cds into the physical repo
# root, guards against `/` and `$HOME`, and requires the repo layout. It then
# re-verifies the pinned Bun install with scripts/verify-bun-binary.sh, pins
# BUN_BIN to the absolute verified binary, and defines a `bun()` shell function
# that only invokes that absolute binary (never a PATH-resolved Bun).
set -euo pipefail
: "${HOME:?HOME is required}"

ROOT="$(cd -P -- "$(git rev-parse --show-toplevel)" && pwd -P)"
HOME_PHYSICAL="$(cd -P -- "$HOME" && pwd -P)"
cd -P -- "$ROOT"
test "$(pwd -P)" = "$ROOT"
test "$ROOT" != "/"
test "$ROOT" != "$HOME_PHYSICAL"
test -f package.json
test -d packages

bash scripts/verify-bun-binary.sh

readonly BUN_BIN="${HOME}/.local/bin/bun-1.3.14"
bun() {
  "$BUN_BIN" "$@"
}
