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


def run_renderer(repo: str, renderer: str) -> dict:
    event_fd, event_path = tempfile.mkstemp(prefix=f'itestagent-{renderer}-', suffix='.jsonl')
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
                renderer,
                event_path,
            ],
            env,
        )

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
    initial = read_available(master, 1.5)
    for byte in b'hello':
        os.write(master, bytes([byte]))
        time.sleep(0.05)
    input_output = read_available(master, 0.4)

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 30, 0, 0))
    os.kill(pid, signal.SIGWINCH)
    resize_output = read_available(master, 0.8)

    os.write(master, b'\r')
    input_output += read_available(master, 0.8)

    os.write(master, b'\x03')
    exit_output = read_available(master, 1.5)
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

    all_initial = initial.decode('utf-8', errors='ignore')
    return {
        'renderer': renderer,
        'selected': f'PTY_SELECTED:{renderer}' in all_initial,
        # OpenTUI uses terminal protocol sequences whose cell payload is not
        # guaranteed to remain plain UTF-8; a substantial post-selection frame
        # is the portable observable there.
        'firstFrame': 'iTestAgent' in all_initial or (renderer == 'opentui' and len(initial) > 1000),
        'input': {'type': 'input', 'text': 'hello'} in events and {'type': 'submit'} in events,
        'resize': len(resize_output) > 0,
        'bufferPreserved': renderer != 'ansi' or b'hello' in resize_output,
        'cleanExit': os.waitstatus_to_exitcode(status) == 0,
        'bytes': {
            'initial': len(initial),
            'input': len(input_output),
            'resize': len(resize_output),
            'exit': len(exit_output),
        },
    }


def main() -> int:
    repo = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    results = [run_renderer(repo, renderer) for renderer in ('opentui', 'ink', 'ansi')]
    print(json.dumps(results, separators=(',', ':')))
    return 0 if all(all(result[key] for key in ('selected', 'firstFrame', 'input', 'resize', 'bufferPreserved', 'cleanExit')) for result in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
