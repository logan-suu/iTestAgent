#!/usr/bin/env python3
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time


def read_available(fd: int, duration: float) -> bytes:
    deadline = time.monotonic() + duration
    chunks = []
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0.0, min(0.05, deadline - time.monotonic())))
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        chunks.append(data)
    return b''.join(chunks)


def main() -> int:
    repo = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    secret = 'itestagent-fake-密钥-612'
    event_fd, event_path = tempfile.mkstemp(prefix='itestagent-opentui-setup-', suffix='.jsonl')
    os.close(event_fd)
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(repo)
        env = dict(os.environ)
        env['TERM'] = 'xterm-256color'
        env.pop('CI', None)
        os.execvpe(
            'bun',
            [
                'bun',
                'tests/integration/phase6/helpers/renderer-pty-harness.ts',
                'opentui',
                event_path,
                'setup-secret',
            ],
            env,
        )

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
    output = read_available(master, 1.5)
    pasted = secret.encode('utf-8')
    os.write(master, b'\x1b[200~' + pasted + b'\x1b[201~')
    output += read_available(master, 0.8)
    os.write(master, b'\r')
    output += read_available(master, 0.8)
    os.write(master, b'\x03')
    output += read_available(master, 1.5)

    deadline = time.monotonic() + 2.0
    status = None
    while time.monotonic() < deadline:
        waited, current = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = current
            break
        time.sleep(0.05)
    if status is None:
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)

    try:
        with open(event_path, encoding='utf-8') as stream:
            events = [json.loads(line) for line in stream if line.strip()]
    finally:
        os.unlink(event_path)
        os.close(master)

    decoded = output.decode('utf-8', errors='ignore')
    result = {
        'selected': 'PTY_SELECTED:opentui' in decoded,
        'inputReceived': {'type': 'input', 'text': secret} in events,
        'submitReceived': {'type': 'submit'} in events,
        'secretNotRendered': secret not in decoded,
        'maskedFrameProduced': len(output) > 1000,
        'cleanExit': os.waitstatus_to_exitcode(status) == 0,
    }
    print(json.dumps(result, separators=(',', ':')))
    return 0 if all(result.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
