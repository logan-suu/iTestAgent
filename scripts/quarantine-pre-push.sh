#!/usr/bin/env bash
#
# quarantine-pre-push.sh -- B00 audit infrastructure (promotion guide §12.1,
# §17). Shared implementation of the pre-push quarantine gate.
#
# Reads git's pre-push ref lines from stdin. Each line has the git pre-push
# shape:
#     <local ref> <local oid> <remote ref> <remote oid>
#
# The gate exits 0 if and only if EVERY line has both a local ref and a remote
# ref that are OUTSIDE the `refs/quarantine/**` namespace. A push whose local
# or remote ref matches `refs/quarantine/**` is rejected (exit non-zero). This
# includes the ref input produced by `git push --all` and `git push --mirror`
# whenever a quarantine ref exists locally. Every stdin line is inspected, not
# only the first.

set -euo pipefail

QUARANTINE_NS="refs/quarantine/"
rejected=0

while IFS=' ' read -r local_ref local_oid remote_ref remote_oid rest; do
  [ -n "$local_ref" ] || continue
  case "$local_ref" in
    "${QUARANTINE_NS}"*) rejected=1 ;;
  esac
  case "$remote_ref" in
    "${QUARANTINE_NS}"*) rejected=1 ;;
  esac
done

if [ "$rejected" -ne 0 ]; then
  echo "quarantine-pre-push: error: push of refs/quarantine/** is forbidden (guide §17)" >&2
  exit 1
fi

exit 0
