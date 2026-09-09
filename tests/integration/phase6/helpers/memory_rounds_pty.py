import fcntl
import json
import os
import pty
import select
import struct
import sys
import tempfile
import termios
import time
from opentui_review_confirmation_pty import visible_text, cleanup_pty_resources

native = len(sys.argv) > 2 and sys.argv[2] == 'native'

with tempfile.TemporaryDirectory(prefix='itestagent-rounds-pty-') as home:
    audit = os.path.join(home, 'audit.json')
    pid, master = pty.fork()
    if pid == 0:
        env = dict(os.environ, HOME=home, TERM='xterm-256color')
        env.pop('CI', None)
        if native: env['ITESTAGENT_NATIVE_PTY'] = '1'
        os.execvpe('bun', ['bun', os.path.join(sys.argv[1], 'tests/integration/phase6/helpers/memory-rounds-pty.ts'), audit], env)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 70, 180, 0, 0))
    content = b''
    def until(label):
        global content
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if label.replace(b' ', b'') in b''.join(visible_text(content).split()):
                content = b''
                return
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try: data = os.read(master, 65536)
                except OSError: break
                if not data: break
                content += data
        raise RuntimeError('Missing controlled checkpoint: ' + label.decode() + '\n' + (open(audit).read() if os.path.exists(audit) else b' '.join(visible_text(content).split())[-6000:].decode(errors='replace')))
    try:
        until(b'iTestAgent ready.')
        os.write(master, ('用 Simulator 跑 workload 测试，确认 Ready 可见，采集内存泄漏\r' if native else '用本机 iPhone 跑 workload 测试，确认 Ready 可见，采集内存增长，观察 1 秒，操作后等待 0 秒\r').encode())
        until(b'Candidate')
        os.write(master, b'A\r')
        until(b'Fixture simulator' if native else b'Fixture phone')
        os.write(master, b'\r')
        # The title shares cells with the preceding review and can arrive as partial diffs.
        # This newly rendered plan-edit instruction is also verified by canonical assertions.
        until(b'baseline=skip')
        if native:
            os.write(master, b'\r')
            until(b'Permission required: prepare_wda')
            os.write(master, b'allow\r')
        else:
            os.write(master, b'm')
            until(b'Modify')
            os.write(master, b'baseline=skip\r')
            until(b'skip')  # OpenTUI updates only the changed field; canonical assertions verify the value.
            os.write(master, b'm')
            until(b'Modify')
            os.write(master, b'/memory-rounds round-workload 3 0\r')
            until(b'Confirmed Flow rounds')
            # The full review exposes the Flow hash and steps before final confirmation.
            os.write(master, b'\r')
            until(b'Permission required: execute_project_build')
            os.write(master, b'allow\r')
            until(b'Permission required: replace_device_app')
            os.write(master, b'allow\r')
            for _ in range(3):
                until(b'Permission required: interact_sensitive_ui')
                os.write(master, b'allow\r')
        until(b'Execution completed')
        os.write(master, b'\x03')
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            child, status = os.waitpid(pid, os.WNOHANG)
            if child:
                if os.waitstatus_to_exitcode(status) != 0: raise RuntimeError('TUI exit failed')
                break
            ready, _, _ = select.select([master], [], [], 0.05)
            if ready:
                try: os.read(master, 65536)
                except OSError: pass
        else: raise RuntimeError('TUI teardown timeout')
        with open(audit) as handle: print(handle.read())
    finally:
        cleanup_pty_resources(pid, master, audit)
