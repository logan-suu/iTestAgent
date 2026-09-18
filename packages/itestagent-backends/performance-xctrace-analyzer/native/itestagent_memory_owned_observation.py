"""Retained LLDB observation only. Never launches, selects, detaches or kills a target."""
import math
import time
import uuid
import itestagent_memory_identity as identity


def _uuid(value):
    return isinstance(value, str) and str(uuid.UUID(value)) == value


class OwnedObservation:
    """One registration per owner session. Release drops references, not resources."""
    def __init__(self, now=time.monotonic):
        self._now = now
        self._used = False
        self._record = None
        self._requests = set()
        self._exited = False

    def _response(self, request, status):
        record = self._record
        return dict(protocolVersion=1, sessionId=record['session'], requestId=request,
                    registrationId=record['registration'], source='retained_lldb_process',
                    debuggerId=record['expected']['debuggerId'],
                    processInstance=record['expected']['processInstance'],
                    pid=record['expected']['pid'], status=status)

    def register(self, debugger, session, request, expected, timeout_seconds):
        import lldb
        if self._used:
            return {'status': 'unverifiable'}
        self._used = True
        try:
            if (not debugger.IsValid() or not _uuid(session) or not _uuid(request) or type(timeout_seconds) not in (int, float)
                    or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 120):
                raise ValueError()
            observed = identity.query(debugger, request)
            if (observed.get('status') != 'observed' or not isinstance(expected, dict)
                    or observed != expected or any(type(expected[key]) is not type(value)
                                                   for key, value in observed.items())):
                raise ValueError()
            target = debugger.GetSelectedTarget()
            process = target.GetProcess()
            if (not target.IsValid() or not process.IsValid()
                    or process.GetUniqueID() != expected['processInstance']
                    or process.GetProcessID() != expected['pid']
                    or debugger.GetID() != expected['debuggerId']
                    or process.GetState() not in (lldb.eStateRunning, lldb.eStateStopped)):
                raise ValueError()
            # Retain actual SB wrappers; do not reconstruct them from PID or inventory.
            self._record = dict(debugger=debugger, target=target, process=process,
                                session=session, registration=str(uuid.uuid4()),
                                expected=dict(expected), deadline=self._now() + timeout_seconds)
            self._requests.add(request)
            return self._response(request, 'registered')
        except Exception:
            self._record = None
            return {'status': 'unverifiable'}

    def _check(self, debugger, session, request, registration):
        record = self._record
        if (record is None or not _uuid(request) or request in self._requests
                or session != record['session'] or registration != record['registration']
                or len(self._requests) >= 128 or self._now() >= record['deadline'] or debugger is not record['debugger']
                or not debugger.IsValid() or debugger.GetID() != record['expected']['debuggerId']):
            raise ValueError()
        self._requests.add(request)
        return record

    def observe(self, debugger, session, request, registration):
        import lldb
        try:
            record = self._check(debugger, session, request, registration)
            process = record['process']
            def matches():
                return (record['target'].IsValid() and process.IsValid()
                        and process.GetUniqueID() == record['expected']['processInstance']
                        and process.GetProcessID() == record['expected']['pid'])
            if not matches():
                raise ValueError()
            state = process.GetState()
            if (state not in (lldb.eStateRunning, lldb.eStateStopped, lldb.eStateExited)
                    or (self._exited and state != lldb.eStateExited)):
                raise ValueError()
            if (not matches() or process.GetState() != state or self._now() >= record['deadline']
                    or not debugger.IsValid() or debugger.GetID() != record['expected']['debuggerId']):
                raise ValueError()
            self._exited = state == lldb.eStateExited
            return self._response(request, 'exited' if self._exited else 'live')
        except Exception:
            # A failed observation poisons this registration. No recovery by reselection.
            self._record = None
            return {'status': 'unverifiable'}

    def release(self, debugger, session, request, registration):
        try:
            self._check(debugger, session, request, registration)
            result = self._response(request, 'released')
            self._record = None
            return result
        except Exception:
            self._record = None
            return {'status': 'unverifiable'}
