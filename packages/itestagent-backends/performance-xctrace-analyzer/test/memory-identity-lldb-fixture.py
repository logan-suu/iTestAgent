"""No-device integration fixture, executed inside an isolated LLDB interpreter."""
import importlib.util
import json
import os
import sys
import uuid
import lldb


class IdentityFixture:
    def __init__(self, debugger, module_path, executable, result_path, exit_requests):
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location('memory_identity_fixture', module_path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.debugger = debugger
        self.target = debugger.CreateTarget(executable)
        debugger.SetSelectedTarget(self.target)
        self.result_path = result_path
        self.process = None
        self.observations = []
        self.exit_requests = exit_requests
        self.result = {'emptyBlocked': self.query()['status'] == 'unverifiable'}
        self.start()

    def query(self):
        return self.module.query(self.debugger, str(uuid.uuid4()))

    def start(self):
        error = lldb.SBError()
        launch = lldb.SBLaunchInfo(None)
        launch.SetLaunchFlags(lldb.eLaunchFlagStopAtEntry)
        self.process = self.target.Launch(launch, error)
        if error.Fail() or not self.process.IsValid():
            raise RuntimeError('fixture.launch_failed')
        first, second = self.query(), self.query()
        if first['status'] != 'observed' or second['status'] != 'observed':
            self.stop()
            raise RuntimeError('fixture.identity_unavailable')
        self.observations.append(first)
        self.result['liveExitBlocked'] = self.exit_query(first)['status'] == 'unverifiable'
        self.result['stableWithinProcess'] = first['processInstance'] == second['processInstance']
        self.result['uuidPresent'] = bool(first['moduleUUID'])

    def stop(self):
        if self.process is None:
            return
        error = self.process.Kill()
        if error.Fail() or self.process.GetState() != lldb.eStateExited:
            raise RuntimeError('fixture.cleanup_failed')
        self.result['exitedBlocked'] = self.query()['status'] == 'unverifiable'
        observed = self.observations[-1]
        self.result['exactExitObserved'] = self.exit_query(observed)['status'] == 'observed_exited'
        self.result['wrongExitIdentityBlocked'] = all(
            self.exit_query(dict(observed, **{key: observed[key] + 1}))['status'] == 'unverifiable'
            for key in ('debuggerId', 'processInstance', 'pid'))
        self.module.emit_exit(self.debugger, self.exit_requests[len(self.observations) - 1],
                              observed['debuggerId'], observed['processInstance'], observed['pid'])
        self.process = None

    def exit_query(self, observed):
        return self.module.query_exit(self.debugger, str(uuid.uuid4()), observed['debuggerId'],
                                      observed['processInstance'], observed['pid'])

    def restart(self):
        self.stop()
        self.start()
        self.result['restartExitBlocked'] = self.exit_query(self.observations[0])['status'] == 'unverifiable'

    def close(self):
        self.stop()
        self.result['generationChanged'] = self.observations[0]['processInstance'] != self.observations[1]['processInstance']
        self.result['debuggerStable'] = self.observations[0]['debuggerId'] == self.observations[1]['debuggerId']
        self.result['cleanupVerified'] = True
        self.debugger.DeleteTarget(self.target)
        self.result['missingTargetExitBlocked'] = self.exit_query(self.observations[-1])['status'] == 'unverifiable'
        fd = os.open(self.result_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(self.result, output)
