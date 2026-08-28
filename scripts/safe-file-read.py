#!/usr/bin/env python3
"""
safe-file-read.py -- B00 audit infrastructure (promotion guide §12.1, §7 line
707, line 1375).

Security-critical file reader that defeats the check-then-use symlink swap:

    python3 scripts/safe-file-read.py --path <absolute-path> [--hash sha256]

The file is opened ONCE through a retained directory-FD chain using
per-component `openat` with `O_NOFOLLOW` (intermediate components opened with
`O_DIRECTORY|O_NOFOLLOW`, the final component opened with `O_RDONLY|O_NOFOLLOW`).
All bytes are read from that SAME retained FD; the pathname is never re-opened
after validation, so a path swap that happens mid-read cannot change the bytes
returned.

The final FD is `fstat`ed: only a regular file (S_ISREG) is accepted. FIFOs,
sockets, device nodes and directories are rejected with a non-zero exit.

Default mode writes the raw file bytes to stdout. With `--hash sha256` the hex
SHA-256 digest of those bytes is written instead.

The very first path component may be a trusted root-level system redirect
(e.g. /var -> /private/var, /tmp -> /private/tmp on macOS); it is resolved to
its physical target before the strict no-follow walk. Every subsequent
component must be a real directory opened with O_NOFOLLOW; any symlink below
the first component is rejected.
"""

import argparse
import hashlib
import os
import stat
import sys


class SafeFileReadError(Exception):
    """Raised when the path must be rejected."""


def reject(message):
    sys.stderr.write("safe-file-read: error: %s\n" % message)
    sys.exit(1)


def walk_open(path):
    """
    Open `path` through a retained directory-FD chain with per-component
    O_NOFOLLOW. Returns the final retained file descriptor, whose content the
    caller reads from the same FD (never re-opening by pathname).
    """
    norm = os.path.normpath(path)
    if not os.path.isabs(norm):
        raise SafeFileReadError("path is not absolute: %r" % path)
    parts = [p for p in norm.split("/") if p]
    if not parts:
        raise SafeFileReadError("path must name a file, not the filesystem root")

    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        # Depth-0: tolerate a trusted root-level system redirect only. This is
        # root-owned system state (e.g. /var -> /private/var); resolving it to
        # its physical target keeps the rest of the walk strictly no-follow.
        first_st = os.lstat(parts[0], dir_fd=fd)
        if stat.S_ISLNK(first_st.st_mode):
            resolved = os.path.realpath("/" + parts[0])
            if not os.path.isabs(resolved):
                raise SafeFileReadError("cannot resolve root component %r" % parts[0])
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

        # Remaining components: strict O_NOFOLLOW walk. Intermediate components
        # must be directories; the final component is opened read-only and is
        # never re-opened afterwards. O_NONBLOCK keeps a FIFO final component
        # from blocking the open so fstat can reject it as non-regular.
        for i, comp in enumerate(rest):
            last = i == len(rest) - 1
            if last:
                flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
            else:
                flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            child = os.open(comp, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except SafeFileReadError:
        os.close(fd)
        raise
    except OSError as exc:
        os.close(fd)
        raise SafeFileReadError(
            "cannot open %r: %s" % (path, exc.strerror or str(exc))
        )


def main():
    parser = argparse.ArgumentParser(description="safe no-follow file reader")
    parser.add_argument("--path", required=True, help="absolute path of the file to read")
    parser.add_argument(
        "--hash",
        choices=["sha256"],
        help="emit the hex SHA-256 of the retained-FD bytes instead of raw bytes",
    )
    args = parser.parse_args()

    try:
        fd = walk_open(args.path)
    except SafeFileReadError as exc:
        reject(str(exc))

    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            reject("not a regular file: %s (mode %o)" % (args.path, st.st_mode & 0o7777))

        # Read ALL bytes from the retained FD.
        chunks = []
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                break
            chunks.append(chunk)
        data = b"".join(chunks)
    finally:
        os.close(fd)

    if args.hash == "sha256":
        sys.stdout.write(hashlib.sha256(data).hexdigest())
        sys.stdout.write("\n")
    else:
        sys.stdout.buffer.write(data)
    sys.stdout.flush()
    sys.exit(0)


if __name__ == "__main__":
    main()
