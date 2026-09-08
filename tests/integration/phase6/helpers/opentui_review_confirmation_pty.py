#!/usr/bin/env python3
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import tempfile
import termios
import time
from typing import Optional

from renderer_pty_matrix import read_initial_frame


ANSI_ESCAPE = re.compile(
    rb'(?:\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_])'
)


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


def visible_text(data: bytes) -> bytes:
    return ANSI_ESCAPE.sub(b'', data)


def cleanup_pty_resources(pid: int, master: int, event_path: str) -> None:
    """Reap only this scenario's child, even when reading its events fails."""
    try:
        try:
            waited, _ = os.waitpid(pid, os.WNOHANG)
            if waited == 0:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        except ChildProcessError:
            pass
    finally:
        try:
            os.close(master)
        except OSError:
            pass
        try:
            os.unlink(event_path)
        except FileNotFoundError:
            pass


def run_scenario(
    repo: str,
    launch_cwd: str,
    scenario: str,
    expected_event: str,
    forbidden_event: Optional[str] = None,
    renderer: str = 'opentui',
    arrow_keys: bool = False,
) -> dict:
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
                renderer,
                event_path,
                scenario,
            ],
            env,
        )

    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 100, 0, 0))
        initial, startup_ms, input_ready = read_initial_frame(master, renderer)
        if arrow_keys:
            for key in (b'\x1b[B', b'\x1b[A'):
                os.write(master, key)
                read_available(master, 0.15)
        try:
            os.write(master, b'\r')
        except OSError:
            pass
        after_enter = read_available(master, 0.8)
        first_events = []
        if scenario == 'device-to-plan':
            with open(event_path, encoding='utf-8') as stream:
                first_events = [json.loads(line) for line in stream if line.strip()]
            try:
                os.write(master, b'\r')
            except OSError:
                pass
            after_followup = read_available(master, 0.8)
        else:
            after_followup = b''
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

        with open(event_path, encoding='utf-8') as stream:
            events = [json.loads(line) for line in stream if line.strip()]

        expected_count = sum(1 for event in events if event == {'type': expected_event})
        forbidden_count = (
            sum(1 for event in first_events if event == {'type': forbidden_event})
            if forbidden_event
            else 0
        )
        visible_followup = visible_text(after_followup)
        compact_followup = re.sub(rb'\s+', b'', visible_followup)
        return {
            'scenario': scenario,
            'selected': f'PTY_SELECTED:{renderer}'.encode() in initial,
            'events': events if arrow_keys else [],
            'firstFrame': len(initial) > 1000,
            'inputReady': input_ready,
            'startupMs': startup_ms,
            'enterEvent': expected_count == 1,
            'enterEventCount': expected_count,
            'forbiddenEventCount': forbidden_count,
            'followupPlanConfirmCount': sum(
                1 for event in events if event == {'type': 'plan_confirm'}
            ),
            'followupRendered': (
                b'Activity:' in compact_followup
                and b'Awaitingpermission:replace_device_app' in compact_followup
                and b'Permissionrequired:replace_device_app' in compact_followup
                and b'physical-device-udid' not in compact_followup
            ),
            'cleanExit': os.waitstatus_to_exitcode(status) == 0,
            'bytes': {
                'initial': len(initial),
                'afterEnter': len(after_enter),
                'exit': len(exit_output),
            },
        }
    finally:
        cleanup_pty_resources(pid, master, event_path)


def run_chat_input_scenario(repo: str, launch_cwd: str) -> dict:
    scenario = 'chat-input'
    event_fd, event_path = tempfile.mkstemp(prefix='itestagent-opentui-chat-input-', suffix='.jsonl')
    os.close(event_fd)
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(launch_cwd)
        env = dict(os.environ)
        env['TERM'] = 'xterm-256color'
        env.pop('CI', None)
        harness = os.path.join(repo, 'tests/integration/phase6/helpers/renderer-pty-harness.ts')
        os.execvpe('bun', ['bun', harness, 'opentui', event_path, scenario], env)

    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 100, 0, 0))
        initial, startup_ms, input_ready = read_initial_frame(master, 'opentui')
        prompt = (
            '用这台真机测试应用：启动后确认“T6.12 Device Lane”可见，点击“Tap Me”，'
            '确认“Taps: 1”可见，并采集截图。'
        )
        os.write(master, prompt.encode('utf-8'))
        read_available(master, 0.5)
        os.write(master, b'\r')
        read_available(master, 0.5)
        os.write(master, b'allow')
        after_allow = read_available(master, 0.5)
        os.write(master, b'\r')
        read_available(master, 0.5)
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

        with open(event_path, encoding='utf-8') as stream:
            events = [json.loads(line) for line in stream if line.strip()]

        inputs = [event.get('text') for event in events if event.get('type') == 'input']
        submit_count = sum(1 for event in events if event == {'type': 'submit'})
        return {
            'scenario': scenario,
            'selected': b'PTY_SELECTED:opentui' in initial,
            'firstFrame': len(initial) > 1000,
            'inputReady': input_ready,
            'startupMs': startup_ms,
            'enterEvent': inputs == [prompt, 'allow'] and submit_count == 2,
            'enterEventCount': submit_count,
            'forbiddenEventCount': 0,
            'followupPlanConfirmCount': 0,
            'followupRendered': b'allow' in visible_text(after_allow),
            'cleanExit': os.waitstatus_to_exitcode(status) == 0,
            'bytes': {
                'initial': len(initial),
                'afterEnter': len(after_allow),
                'exit': len(exit_output),
            },
        }
    finally:
        cleanup_pty_resources(pid, master, event_path)


def main() -> int:
    repo = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    with tempfile.TemporaryDirectory(prefix='itestagent-external-workspace-') as launch_cwd:
        results = [
            run_scenario(repo, launch_cwd, 'candidate-review', 'candidate_confirm'),
            run_scenario(repo, launch_cwd, 'device-review', 'device_confirm'),
            run_scenario(repo, launch_cwd, 'plan-review', 'plan_confirm'),
            run_scenario(
                repo,
                launch_cwd,
                'device-to-plan',
                'device_confirm',
                'plan_confirm',
            ),
            run_chat_input_scenario(repo, launch_cwd),
        ]
    print(json.dumps(results, separators=(',', ':')))
    required = ('selected', 'firstFrame', 'inputReady', 'enterEvent', 'cleanExit')
    return 0 if all(
        all(result[key] for key in required)
        and result['forbiddenEventCount'] == 0
        and (
            result['scenario'] not in ('device-to-plan', 'chat-input')
            or (
                result['scenario'] == 'device-to-plan'
                and result['followupPlanConfirmCount'] == 1
                and result['followupRendered']
            )
            or (
                result['scenario'] == 'chat-input'
                and result['enterEventCount'] == 2
                and result['followupRendered']
            )
        )
        for result in results
    ) else 1


if __name__ == '__main__':
    raise SystemExit(main())
