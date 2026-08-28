#!/usr/bin/env bash
# verify-gitleaks-binary.sh — G7 fail-closed integrity check for the pinned
# gitleaks binary (promotion guide §7.3, §12.1).
#
# Every G7 run re-verifies the cached archive SHA-256, freshly extracts the
# archive to a temp dir and `cmp`s the extracted `gitleaks` bytes against the
# installed binary, and checks the self-reported version. It never trusts a
# self-reported version alone.
#
# Env contract (see tests/security/gitleaks-binary-integrity.test.ts):
#   GITLEAKS_ARCHIVE_SHA   (required) expected SHA-256 of the cached archive.
#                           Mismatch -> exit 1 (fail closed).
#   GITLEAKS_ARCHIVE       (required) path to the cached archive.
#                           Missing file -> exit 1.
#   GITLEAKS_BINARY_PATH   (required) path of the installed binary. The script
#                           extracts the archive to a temp dir and `cmp`s the
#                           fresh `gitleaks` bytes against this path. Any byte
#                           difference -> exit 1.
#   GITLEAKS_VERSION       (required) pinned version string; `"$BINARY"
#                           version` must equal it, else exit 1.
#   GITLEAKS_EXTRACT_DIR   (optional) override the temp extraction dir.
#
# With no env vars the script re-verifies the real pinned gitleaks 8.28.0
# install under $HOME (.cache archive + .local/bin binary + version).
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
  printf '%s\n' "verify-gitleaks-binary: $*" >&2
  exit 1
}

# ─── Mode selection: env-driven vs. real install ────────────────────────────
ENV_MODE=0
if [[ -n "${GITLEAKS_ARCHIVE_SHA:-}" || -n "${GITLEAKS_ARCHIVE:-}" || -n "${GITLEAKS_BINARY_PATH:-}" || -n "${GITLEAKS_VERSION:-}" ]]; then
  ENV_MODE=1
fi

if [[ "$ENV_MODE" -eq 1 ]]; then
  [[ -n "${GITLEAKS_ARCHIVE_SHA:-}" ]] || fail 'GITLEAKS_ARCHIVE_SHA is required'
  [[ -n "${GITLEAKS_ARCHIVE:-}" ]] || fail 'GITLEAKS_ARCHIVE is required'
  [[ -n "${GITLEAKS_BINARY_PATH:-}" ]] || fail 'GITLEAKS_BINARY_PATH is required'
  [[ -n "${GITLEAKS_VERSION:-}" ]] || fail 'GITLEAKS_VERSION is required'
  ARCHIVE_SHA="$GITLEAKS_ARCHIVE_SHA"
  ARCHIVE="$GITLEAKS_ARCHIVE"
  BINARY="$GITLEAKS_BINARY_PATH"
  VERSION="$GITLEAKS_VERSION"
  EXTRACT_DIR="${GITLEAKS_EXTRACT_DIR:-}"
else
  GITLEAKS_VERSION="8.28.0"
  CACHE_DIR="${HOME}/.cache/itestagent-tools/gitleaks-${GITLEAKS_VERSION}"
  GOBIN="${HOME}/.local/bin"
  # Pinned asset/checksum matrix (guide §7.3).
  case "$(uname -s):$(uname -m)" in
    Darwin:arm64)  ASSET="gitleaks_8.28.0_darwin_arm64.tar.gz"; EXPECTED_SHA256="d942f3ad147250c9edbaab3fed9e482f98d3b59ba10ae97b8d75647e3ade492c" ;;
    Darwin:x86_64) ASSET="gitleaks_8.28.0_darwin_x64.tar.gz";  EXPECTED_SHA256="edf5a507008b0d2ef4959575772772770586409c1f6f74dabf19cbe7ec341ced" ;;
    Linux:x86_64)  ASSET="gitleaks_8.28.0_linux_x64.tar.gz";   EXPECTED_SHA256="a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb" ;;
    Linux:aarch64) ASSET="gitleaks_8.28.0_linux_arm64.tar.gz"; EXPECTED_SHA256="eff65261156100e5d94a6b3dec313d532fddfe19ae1590bf7a2b4f2699128356" ;;
    *) fail 'unsupported platform for pinned gitleaks install' ;;
  esac
  ARCHIVE_SHA="$EXPECTED_SHA256"
  ARCHIVE="${CACHE_DIR}/${ASSET}"
  BINARY="${GOBIN}/gitleaks"
  VERSION="$GITLEAKS_VERSION"
  EXTRACT_DIR=""
fi

# 1. Cached archive must exist.
[[ -f "$ARCHIVE" ]] || fail "cached archive not found: $ARCHIVE"

# 2. Cached archive SHA-256 must match the pinned/signed value.
ACTUAL_SHA="$(sha256_file "$ARCHIVE")"
[[ "$ACTUAL_SHA" = "$ARCHIVE_SHA" ]] \
  || fail "archive SHA-256 mismatch (expected ${ARCHIVE_SHA}, got ${ACTUAL_SHA})"

# 3. Installed binary must exist.
[[ -f "$BINARY" ]] || fail "installed binary not found: $BINARY"

# 4. Freshly extract the archive and `cmp` against the installed binary.
if [[ -n "$EXTRACT_DIR" ]]; then
  TMP="$EXTRACT_DIR"
  mkdir -p "$TMP"
  OWN_TMP=0
else
  TMP="$(mktemp -d)"
  OWN_TMP=1
fi
cleanup() {
  if [[ "$OWN_TMP" -eq 1 ]]; then
    rm -rf -- "$TMP"
  fi
}
trap cleanup EXIT

# Extract the `gitleaks` member first (guide §7.3); fall back to full extract.
if ! tar -xzf "$ARCHIVE" -C "$TMP" gitleaks 2>/dev/null; then
  tar -xzf "$ARCHIVE" -C "$TMP" || fail "failed to extract archive: $ARCHIVE"
fi

FRESH_BINARY="$(find "$TMP" -type f -name gitleaks -print -quit)"
[[ -n "$FRESH_BINARY" ]] || fail 'no gitleaks file found in extracted archive'
cmp -s "$FRESH_BINARY" "$BINARY" \
  || fail 'installed binary bytes differ from freshly extracted archive'

# 5. Self-reported version must equal the pinned version.
if ! VERSION_OUTPUT="$("$BINARY" version 2>/dev/null | tr -d '[:space:]')"; then
  fail "could not read version from $BINARY"
fi
[[ "$VERSION_OUTPUT" = "$VERSION" ]] \
  || fail "version mismatch (expected ${VERSION}, got ${VERSION_OUTPUT})"

printf '%s\n' 'ok'
