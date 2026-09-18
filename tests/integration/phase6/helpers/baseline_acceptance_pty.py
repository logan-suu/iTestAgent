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

from opentui_review_confirmation_pty import visible_text, cleanup_pty_resources

def scenario(repo, decision):
    with tempfile.TemporaryDirectory(prefix='itestagent-baseline-pty-') as home:
        audit = os.path.join(home, 'audit.json')
        pid, master = pty.fork()
        if pid == 0:
            env = dict(os.environ, HOME=home, TERM='xterm-256color')
            env.pop('CI', None)
            os.execvpe('bun', ['bun', os.path.join(repo, 'tests/integration/phase6/helpers/baseline-acceptance-pty.ts'), audit], env)
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
        content = b''
        def until(label):
            nonlocal content
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if label.replace(b' ', b'') in b''.join(visible_text(content).split()): return
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    try: data = os.read(master, 65536)
                    except OSError: break
                    if not data: break
                    content += data
            raise RuntimeError('Expected controlled TUI checkpoint was not observed')
        try:
            until(b'iTestAgent ready.')
            os.write(master, b'/baseline accept run-baseline-selected\r')
            until(b'Permission required: update_baseline')
            preview = b'50.000000MiB' in b''.join(visible_text(content).split()) and b'30.000000MiB' in b''.join(visible_text(content).split())
            if decision != 'cancel':
                os.write(master, decision.encode() + b'\r')
                until(b'Memory baseline updated' if decision == 'allow' else b'baseline_denied')
            os.write(master, b'\x03')
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                child, status = os.waitpid(pid, os.WNOHANG)
                if child:
                    if os.waitstatus_to_exitcode(status) != 0: raise RuntimeError('TUI did not exit cleanly')
                    break
                ready, _, _ = select.select([master], [], [], 0.05)
                if ready:
                    try: content += os.read(master, 65536)
                    except OSError: pass
            else: raise RuntimeError('TUI exit timeout; audit_written=' + str(os.path.exists(audit)))
            with open(audit) as handle: result = json.load(handle)
            return dict(result, decision=decision, preview=preview)
        finally:
            cleanup_pty_resources(pid, master, audit)

print(json.dumps([scenario(sys.argv[1], decision) for decision in ['allow', 'deny', 'cancel']]))
