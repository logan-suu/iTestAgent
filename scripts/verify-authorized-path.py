#!/usr/bin/env python3
"""
verify-authorized-path.py -- B00 audit infrastructure (promotion guide §12.1)
plus B40/G5 context (external project directory authorization).

    python3 scripts/verify-authorized-path.py --directory <path>

This gate guards external G5/G5-SIM project directories (e.g.
ITESTAGENT_IOS_PROJECT, ITESTAGENT_WDA_PROJECT) before any test run.

It requires:
  (a) an ABSOLUTE path (a relative path is rejected);
  (b) every component below the trusted root-level system redirect (e.g.
      /var -> /private/var on macOS) is opened with O_NOFOLLOW -- any symlink
      component (intermediate or final) is rejected;
  (c) the final component is an existing directory.

On success it prints the canonical (fully resolved, symlink-free) path to
stdout and exits 0. Callers use command substitution to re-bind the variable.
"""

import argparse
import os
import stat
import sys


class AuthorizedPathError(Exception):
    """Raised when the directory must be rejected."""


def reject(message):
    sys.stderr.write("verify-authorized-path: error: %s\n" % message)
    sys.exit(1)


def walk_physical_directory(path):
    """
    Walk the absolute path with per-component O_NOFOLLOW and return the fully
    resolved canonical path, or raise AuthorizedPathError.
    """
    norm = os.path.normpath(path)
    if not os.path.isabs(norm):
        raise AuthorizedPathError("path is not absolute: %r" % path)
    parts = [p for p in norm.split("/") if p]
    if not parts:
        raise AuthorizedPathError("path resolves to the filesystem root")

    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        # Depth-0: tolerate a trusted root-level system redirect only. This is
        # root-owned system state (e.g. /var -> /private/var); resolving it to
        # its physical target keeps the rest of the walk strictly no-follow.
        first_st = os.lstat(parts[0], dir_fd=fd)
        if stat.S_ISLNK(first_st.st_mode):
            resolved = os.path.realpath("/" + parts[0])
            if not os.path.isabs(resolved):
                raise AuthorizedPathError("cannot resolve root component %r" % parts[0])
            for comp in [p for p in resolved.split("/") if p]:
                child = os.open(comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            rest = parts[1:]
        else:
            child = os.open(parts[0], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            rest = parts[1:]

        # Remaining (user-controlled) components must be real directories.
        for comp in rest:
            child = os.open(comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child

        st = os.fstat(fd)
        if not stat.S_ISDIR(st.st_mode):
            raise AuthorizedPathError("final component is not a directory: %r" % path)
    except AuthorizedPathError:
        raise
    except OSError as exc:
        raise AuthorizedPathError(
            "cannot open %r: %s" % (path, exc.strerror or str(exc))
        )
    finally:
        os.close(fd)

    return os.path.realpath(norm)


def main():
    parser = argparse.ArgumentParser(description="verify an authorized physical directory")
    parser.add_argument("--directory", required=True, help="absolute path of the directory")
    args = parser.parse_args()

    try:
        canonical = walk_physical_directory(args.directory)
    except AuthorizedPathError as exc:
        reject(str(exc))

    sys.stdout.write(canonical)
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(0)


if __name__ == "__main__":
    main()
