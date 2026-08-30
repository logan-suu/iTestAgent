#!/usr/bin/env bash
# verify-bun-binary.sh — G7 fail-closed integrity check for the pinned Bun
# runtime, the approved lockfile, and the install policy (guide §7.0, §12.1).
#
# Every prelude re-verifies the cached Bun ZIP checksum, freshly extracts the
# ZIP and `cmp`s the extracted `bun` bytes against the installed absolute
# binary. It also verifies the lockfile on disk is bound to the signed/approved
# SHA-256 and that lifecycle scripts are not requested before G7 has passed.
#
# Env contract (see tests/security/bun-binary-integrity.test.ts):
#   BUN_ARCHIVE_SHA         (required) expected SHA-256 of the cached Bun ZIP.
#                           Mismatch -> exit 1 (fail closed).
#   BUN_ARCHIVE             (required) path to the cached ZIP. Missing -> exit 1.
#   BUN_BINARY_PATH         (required) path of the installed Bun binary. The
#                           script extracts the ZIP to a temp dir and `cmp`s the
#                           fresh `bun` bytes against this path. Any byte
#                           difference -> exit 1.
#   BUN_LOCK_PATH           (required) path of the lockfile to verify.
#                           Defaults to <repo-root>/bun.lock.
#   BUN_LOCK_EXPECTED_SHA   (optional, RETIRED per ADR-024) SHA-256 of the
#                           signed/approved lock. The migration (B00-B42) is
#                           complete — the promotion approval's lock anchor is
#                           frozen as a historical record and no longer
#                           enforced. Dependency changes are governed by the
#                           standard gates (G1-G7, CodeRabbit, allowed-edges).
#   BUN_LIFECYCLE_SCRIPTS   (optional, default "0"). If "1" — an install that
#                           would run lifecycle scripts BEFORE G7 passed — the
#                           script must fail closed -> exit 1.
#
# With no env vars the script re-verifies the real pinned Bun 1.3.14 install
# under $HOME (cache + .local/bin binary) and the repository's approved
# lockfile bound to docs/05-planning/promotion-plan-approval.json.
#
# On success prints exactly one line `ok` to stdout and exits 0. On any
# failure it prints an error to stderr, does NOT print `ok`, and exits non-zero.
set -euo pipefail

: "${HOME:?HOME is required}"

# Portable SHA-256 helper (guide §12.2).
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    printf '%s\n' 'SHA-256 tool not found' >&2
    return 1
  fi
}

fail() {
  printf '%s\n' "verify-bun-binary: $*" >&2
  exit 1
}

# ─── Mode selection: env-driven vs. real install ────────────────────────────
ENV_MODE=0
if [[ -n "${BUN_ARCHIVE_SHA:-}" || -n "${BUN_ARCHIVE:-}" || -n "${BUN_BINARY_PATH:-}" \
  || -n "${BUN_LOCK_PATH:-}" || -n "${BUN_LOCK_EXPECTED_SHA:-}" ]]; then
  ENV_MODE=1
fi

if [[ "$ENV_MODE" -eq 1 ]]; then
  [[ -n "${BUN_ARCHIVE_SHA:-}" ]] || fail 'BUN_ARCHIVE_SHA is required'
  [[ -n "${BUN_ARCHIVE:-}" ]] || fail 'BUN_ARCHIVE is required'
  [[ -n "${BUN_BINARY_PATH:-}" ]] || fail 'BUN_BINARY_PATH is required'
  [[ -n "${BUN_LOCK_EXPECTED_SHA:-}" ]] || fail 'BUN_LOCK_EXPECTED_SHA is required'
  ARCHIVE_SHA="$BUN_ARCHIVE_SHA"
  ARCHIVE="$BUN_ARCHIVE"
  BINARY="$BUN_BINARY_PATH"
  if [[ -n "${BUN_LOCK_PATH:-}" ]]; then
    LOCK_PATH="$BUN_LOCK_PATH"
  else
    REPO_ROOT="$(cd -P -- "$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")" && pwd -P)"
    LOCK_PATH="${REPO_ROOT}/bun.lock"
  fi
  LOCK_EXPECTED_SHA="$BUN_LOCK_EXPECTED_SHA"
  LIFECYCLE_SCRIPTS="${BUN_LIFECYCLE_SCRIPTS:-0}"
else
  BUN_VERSION="1.3.14"
  BUN_CACHE="${HOME}/.cache/itestagent-tools/bun-${BUN_VERSION}"
  BUN_BIN="${HOME}/.local/bin/bun-${BUN_VERSION}"
  # Pinned asset/checksum matrix (guide §7.0).
  case "$(uname -s):$(uname -m)" in
    Darwin:arm64)  ASSET="bun-darwin-aarch64.zip"; EXPECTED_SHA256="d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620" ;;
    Darwin:x86_64) ASSET="bun-darwin-x64.zip";     EXPECTED_SHA256="4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633" ;;
    Linux:aarch64) ASSET="bun-linux-aarch64.zip";  EXPECTED_SHA256="a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b" ;;
    Linux:x86_64)  ASSET="bun-linux-x64.zip";      EXPECTED_SHA256="951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f" ;;
    *) fail 'unsupported platform for pinned Bun install' ;;
  esac
  ARCHIVE_SHA="$EXPECTED_SHA256"
  ARCHIVE="${BUN_CACHE}/${ASSET}"
  BINARY="$BUN_BIN"
  REPO_ROOT="$(cd -P -- "$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")" && pwd -P)"
  LOCK_PATH="${REPO_ROOT}/bun.lock"
  APPROVAL_FILE="${REPO_ROOT}/docs/05-planning/promotion-plan-approval.json"
  # ADR-024: the migration is complete — the approval file's lock anchor is
  # retired (frozen as a historical record, no longer read). An explicit
  # BUN_LOCK_EXPECTED_SHA env var remains the re-approval path for future
  # promotion-style batches.
  LOCK_EXPECTED_SHA="${BUN_LOCK_EXPECTED_SHA:-}"
  if [[ -z "$LOCK_EXPECTED_SHA" ]]; then
    echo "verify-bun-binary: lock anchor retired per ADR-024 — skipping lock SHA check"
  fi
  LIFECYCLE_SCRIPTS="0"
fi

# 1. Lifecycle scripts must never run before G7 has passed.
if [[ "$LIFECYCLE_SCRIPTS" = "1" ]]; then
  fail 'lifecycle scripts requested before G7: blocked (fail closed)'
fi

# 2. The lockfile on disk must be bound to the signed/approved SHA-256 —
# skipped when the anchor is retired (ADR-024: migration complete).
[[ -f "$LOCK_PATH" ]] || fail "lockfile not found: $LOCK_PATH"
LOCK_ACTUAL_SHA="$(sha256_file "$LOCK_PATH")"
if [[ -n "$LOCK_EXPECTED_SHA" ]]; then
  [[ "$LOCK_ACTUAL_SHA" = "$LOCK_EXPECTED_SHA" ]] \
    || fail "lockfile SHA-256 mismatch (approved ${LOCK_EXPECTED_SHA}, on disk ${LOCK_ACTUAL_SHA})"
fi

# 3. Cached ZIP must exist.
[[ -f "$ARCHIVE" ]] || fail "cached Bun ZIP not found: $ARCHIVE"

# 4. Cached ZIP SHA-256 must match the pinned/signed value.
ZIP_ACTUAL_SHA="$(sha256_file "$ARCHIVE")"
[[ "$ZIP_ACTUAL_SHA" = "$ARCHIVE_SHA" ]] \
  || fail "Bun ZIP SHA-256 mismatch (expected ${ARCHIVE_SHA}, got ${ZIP_ACTUAL_SHA})"

# 5. Installed binary must exist.
[[ -f "$BINARY" ]] || fail "installed Bun binary not found: $BINARY"

# 6. Freshly extract the ZIP and `cmp` against the installed binary.
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
unzip -q "$ARCHIVE" -d "$TMP" || fail "failed to extract Bun ZIP: $ARCHIVE"

FRESH_BINARY="$(find "$TMP" -type f -name bun -print -quit)"
[[ -n "$FRESH_BINARY" ]] || fail 'no bun file found in extracted ZIP'
cmp -s "$FRESH_BINARY" "$BINARY" \
  || fail 'installed Bun binary bytes differ from freshly extracted ZIP'

# 7. In no-env mode the real install must report the pinned version.
if [[ "$ENV_MODE" -eq 0 ]]; then
  if ! VERSION_OUTPUT="$("$BINARY" --version 2>/dev/null | tr -d '[:space:]')"; then
    fail "could not read version from $BINARY"
  fi
  [[ "$VERSION_OUTPUT" = "$BUN_VERSION" ]] \
    || fail "Bun version mismatch (expected ${BUN_VERSION}, got ${VERSION_OUTPUT})"
fi

printf '%s\n' 'ok'
