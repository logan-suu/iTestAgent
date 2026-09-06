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


def run_scenario(repo: str, launch_cwd: str, scenario: str, expected_event: str) -> dict:
    event_fd, event_path = tempfile.mkstemp(prefix=f'itestagent-opentui-{scenario}-', suffix='.jsonl')
    os.close(event_fd)
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(launch_cwd)
        env = dict(os.environ)
        env['TERM'] = 'xterm-256color'
        env.pop('CI', None)
        harness = os.path.join(
            repo,
            'tests/integration/phase6/helpers/renderer-pty-harness.ts',
        )
        os.execvpe(
            'bun',
            [
                'bun',
                harness,
                'opentui',
                event_path,
                scenario,
            ],
            env,
        )

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 100, 0, 0))
    initial = read_available(master, 1.5)
    try:
        os.write(master, b'\r')
    except OSError:
        pass
    after_enter = read_available(master, 0.8)
    try:
        os.write(master, b'\x03')
    except OSError:
        pass
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

    return {
        'scenario': scenario,
        'selected': b'PTY_SELECTED:opentui' in initial,
        'firstFrame': len(initial) > 1000,
        'enterEvent': {'type': expected_event} in events,
        'cleanExit': os.waitstatus_to_exitcode(status) == 0,
        'bytes': {
            'initial': len(initial),
            'afterEnter': len(after_enter),
            'exit': len(exit_output),
        },
    }


def main() -> int:
    repo = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    with tempfile.TemporaryDirectory(prefix='itestagent-external-workspace-') as launch_cwd:
        results = [
            run_scenario(repo, launch_cwd, 'candidate-review', 'candidate_confirm'),
            run_scenario(repo, launch_cwd, 'device-review', 'device_confirm'),
            run_scenario(repo, launch_cwd, 'plan-review', 'plan_confirm'),
        ]
    print(json.dumps(results, separators=(',', ':')))
    required = ('selected', 'firstFrame', 'enterEvent', 'cleanExit')
    return 0 if all(all(result[key] for key in required) for result in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
