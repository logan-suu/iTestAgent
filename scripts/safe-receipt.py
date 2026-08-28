#!/usr/bin/env python3
"""
safe-receipt.py -- B00 audit infrastructure (promotion guide §12.1, §12.3).

Secure management of Git-dir-local receipts (baseline, gate and lock receipts)
under `$GIT_DIR/itestagent-receipts/`. Receipts are never committed; they carry
the machine-auditable RED/GREEN/G7 state between the promotion steps.

Security model (same retained-FD discipline as safe-file-read.py):
  - Every path must be absolute.
  - The path is walked from `/` with per-component `openat`/`O_NOFOLLOW` through
    a retained directory-FD chain. Only the depth-0 trusted root-level system
    redirect (e.g. /var -> /private/var on macOS) is tolerated; any symlink
    below it is rejected.
  - Files are created with `O_CREAT|O_EXCL|O_NOFOLLOW`, mode 0600 (forced with
    fchmod), written and fsync'ed through the SAME retained FD.
  - Reads happen from the retained FD after fstat validation (regular file,
    owner == euid, mode & 0o077 == 0). The pathname is never re-opened.
  - Directories are mode 0700, owned by the current user, no group/other bits.

Subcommands:
  init-dir  --path <dir>                         create/verify a receipt dir
  write-text --exclusive --path <file> --value <text>
                                                create a file exclusively with
                                                the exact value bytes
  read-field --path <file> --field <name>       print one JSON field value
  remove  --path <file> [--allow-absent]        unlink via the parent dir FD

Exit codes:
  0  success
  1  validation / operational failure (fail-closed)
  2  usage error
"""

import argparse
import json
import os
import stat
import sys


class SafeReceiptError(Exception):
    """Raised when a receipt path must be rejected."""


def reject(message):
    sys.stderr.write("safe-receipt: error: %s\n" % message)
    sys.exit(1)


def usage(message):
    sys.stderr.write("safe-receipt: %s\n" % message)
    sys.stderr.write(
        "usage:\n"
        "  safe-receipt.py init-dir --path <dir>\n"
        "  safe-receipt.py write-text --exclusive --path <file> --value <text>\n"
        "  safe-receipt.py read-field --path <file> --field <name>\n"
        "  safe-receipt.py remove --path <file> [--allow-absent]\n"
    )
    sys.exit(2)


def split_absolute(path):
    """Return the non-empty components of an absolute path, or raise."""
    norm = os.path.normpath(path)
    if not os.path.isabs(norm):
        raise SafeReceiptError("path is not absolute: %r" % path)
    parts = [p for p in norm.split("/") if p]
    if not parts:
        raise SafeReceiptError("path must not be the filesystem root")
    return norm, parts


def open_root_fd():
    """Open `/` read-only as a directory FD to start the no-follow walk."""
    try:
        return os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    except OSError as exc:
        raise SafeReceiptError("cannot open /: %s" % (exc.strerror or str(exc)))


def descend(fd, component, flags):
    """Open one component relative to `fd`; closes the old fd on success."""
    try:
        child = os.open(component, flags, dir_fd=fd)
    except OSError as exc:
        raise SafeReceiptError(
            "cannot open component %r: %s" % (component, exc.strerror or str(exc))
        )
    os.close(fd)
    return child


def walk_to_parent(path):
    """
    Walk the absolute path to the PARENT directory and return
    (parent_fd, basename). The depth-0 trusted root-level system redirect is
    resolved to its physical target; every remaining component must be a real
    directory opened with O_NOFOLLOW.
    """
    norm, parts = split_absolute(path)
    if len(parts) == 1:
        raise SafeReceiptError("path has no parent directory: %r" % path)
    parent_parts = parts[:-1]
    basename = parts[-1]

    fd = open_root_fd()
    try:
        # Depth-0: tolerate a trusted root-level system redirect only.
        first_st = os.lstat(parts[0], dir_fd=fd)
        if stat.S_ISLNK(first_st.st_mode):
            resolved = os.path.realpath("/" + parts[0])
            if not os.path.isabs(resolved):
                raise SafeReceiptError("cannot resolve root component %r" % parts[0])
            for comp in [p for p in resolved.split("/") if p]:
                fd = descend(fd, comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            rest = parent_parts[1:]
        else:
            fd = descend(fd, parent_parts[0], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            rest = parent_parts[1:]

        for comp in rest:
            fd = descend(fd, comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except SafeReceiptError:
        os.close(fd)
        raise
    except OSError as exc:
        os.close(fd)
        raise SafeReceiptError(
            "cannot walk %r: %s" % (path, exc.strerror or str(exc))
        )
    return fd, basename


def walk_open_dir(path):
    """
    Open the directory at `path` through a retained no-follow FD chain and
    return the FD. The final component must be an existing real directory.
    """
    norm, parts = split_absolute(path)
    fd = open_root_fd()
    try:
        first_st = os.lstat(parts[0], dir_fd=fd)
        if stat.S_ISLNK(first_st.st_mode):
            resolved = os.path.realpath("/" + parts[0])
            if not os.path.isabs(resolved):
                raise SafeReceiptError("cannot resolve root component %r" % parts[0])
            for comp in [p for p in resolved.split("/") if p]:
                fd = descend(fd, comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            rest = parts[1:]
        else:
            fd = descend(fd, parts[0], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            rest = parts[1:]
        for comp in rest:
            fd = descend(fd, comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except SafeReceiptError:
        os.close(fd)
        raise
    except OSError as exc:
        os.close(fd)
        raise SafeReceiptError(
            "cannot open directory %r: %s" % (path, exc.strerror or str(exc))
        )
    return fd


def verify_dir(fd, path, require_empty_bits=True):
    """fstat a directory FD: S_ISDIR, owner == euid, no group/other bits."""
    st = os.fstat(fd)
    if not stat.S_ISDIR(st.st_mode):
        raise SafeReceiptError("not a directory: %r" % path)
    if st.st_uid != os.getuid():
        raise SafeReceiptError(
            "directory %r is not owned by the current user" % path
        )
    if require_empty_bits and (st.st_mode & 0o077) != 0:
        raise SafeReceiptError(
            "directory %r has group/other bits set (mode %o)" % (path, st.st_mode & 0o7777)
        )


def read_retained(fd, path):
    """Read all bytes from the retained FD after fstat validation."""
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode):
        raise SafeReceiptError("not a regular file: %r (mode %o)" % (path, st.st_mode & 0o7777))
    if st.st_uid != os.getuid():
        raise SafeReceiptError("file %r is not owned by the current user" % path)
    if (st.st_mode & 0o077) != 0:
        raise SafeReceiptError(
            "file %r has group/other bits set (mode %o)" % (path, st.st_mode & 0o7777)
        )
    chunks = []
    while True:
        chunk = os.read(fd, 1 << 20)
        if not chunk:
            break
        chunks.append(chunk)
    return b"".join(chunks)


def cmd_init_dir(args):
    fd = walk_open_dir(args.path) if os.path.isdir(args.path) else None
    if fd is None:
        # Directory does not exist yet: create it through the parent dir FD.
        parent_fd, basename = walk_to_parent(args.path)
        try:
            try:
                os.mkdir(basename, mode=0o700, dir_fd=parent_fd)
            except FileExistsError:
                pass
            fd = os.open(basename, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        except OSError as exc:
            raise SafeReceiptError(
                "cannot create directory %r: %s" % (args.path, exc.strerror or str(exc))
            )
        finally:
            os.close(parent_fd)
    try:
        verify_dir(fd, args.path)
        os.fchmod(fd, 0o700)
    finally:
        os.close(fd)
    sys.stdout.write("safe-receipt: init-dir: OK %s\n" % args.path)
    sys.exit(0)


def cmd_write_text(args):
    if not args.exclusive:
        usage("write-text requires --exclusive")
    value = args.value.encode("utf-8")
    parent_fd, basename = walk_to_parent(args.path)
    fd = None
    try:
        fd = os.open(
            basename,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=parent_fd,
        )
        # Force the exact mode regardless of the process umask.
        os.fchmod(fd, 0o600)
        os.write(fd, value)
        os.fsync(fd)
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise SafeReceiptError("created file is not regular: %r" % args.path)
        if st.st_uid != os.getuid():
            raise SafeReceiptError("created file is not owned by the current user: %r" % args.path)
        if (st.st_mode & 0o077) != 0:
            raise SafeReceiptError(
                "created file has group/other bits set (mode %o): %r" % (st.st_mode & 0o7777, args.path)
            )
    except OSError as exc:
        raise SafeReceiptError(
            "cannot create %r: %s" % (args.path, exc.strerror or str(exc))
        )
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent_fd)
    sys.stdout.write("safe-receipt: write-text: OK %s\n" % args.path)
    sys.exit(0)


def cmd_read_field(args):
    parent_fd, basename = walk_to_parent(args.path)
    fd = None
    try:
        fd = os.open(basename, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        data = read_retained(fd, args.path)
    except OSError as exc:
        raise SafeReceiptError(
            "cannot open %r: %s" % (args.path, exc.strerror or str(exc))
        )
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent_fd)
    try:
        parsed = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise SafeReceiptError("receipt %r is not valid JSON: %s" % (args.path, exc))
    if not isinstance(parsed, dict):
        raise SafeReceiptError("receipt %r is not a JSON object" % args.path)
    if args.field not in parsed:
        raise SafeReceiptError("receipt %r has no field %r" % (args.path, args.field))
    value = parsed[args.field]
    if isinstance(value, str):
        sys.stdout.write(value)
    else:
        sys.stdout.write(json.dumps(value))
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(0)


def cmd_remove(args):
    parent_fd, basename = walk_to_parent(args.path)
    try:
        try:
            os.unlink(basename, dir_fd=parent_fd)
        except FileNotFoundError:
            if not args.allow_absent:
                raise SafeReceiptError("no such receipt: %r" % args.path)
    finally:
        os.close(parent_fd)
    sys.stdout.write("safe-receipt: remove: OK %s\n" % args.path)
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser(prog="safe-receipt.py")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    p_init = sub.add_parser("init-dir")
    p_init.add_argument("--path", required=True)

    p_write = sub.add_parser("write-text")
    p_write.add_argument("--exclusive", action="store_true")
    p_write.add_argument("--path", required=True)
    p_write.add_argument("--value", required=True)

    p_read = sub.add_parser("read-field")
    p_read.add_argument("--path", required=True)
    p_read.add_argument("--field", required=True)

    p_remove = sub.add_parser("remove")
    p_remove.add_argument("--path", required=True)
    p_remove.add_argument("--allow-absent", action="store_true")

    args = parser.parse_args()
    if args.subcommand is None:
        usage("a subcommand is required")

    try:
        if args.subcommand == "init-dir":
            cmd_init_dir(args)
        elif args.subcommand == "write-text":
            cmd_write_text(args)
        elif args.subcommand == "read-field":
            cmd_read_field(args)
        elif args.subcommand == "remove":
            cmd_remove(args)
        else:  # pragma: no cover - argparse restricts the choice
            usage("unknown subcommand %r" % args.subcommand)
    except SafeReceiptError as exc:
        reject(str(exc))


if __name__ == "__main__":
    main()
