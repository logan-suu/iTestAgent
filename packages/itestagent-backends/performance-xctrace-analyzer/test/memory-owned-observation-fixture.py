"""Fake public LLDB objects; no debugger or application is launched."""
import sys
import types
import uuid
import json
sys.path.insert(0, sys.argv[1])
sys.modules['lldb'] = types.SimpleNamespace(eStateRunning=1, eStateStopped=2, eStateExited=3)
import itestagent_memory_owned_observation as module

class Process:
    valid = True
    pid = 123
    instance = 1
    state = 2
    def IsValid(self): return self.valid
    def GetUniqueID(self): return self.instance
    def GetProcessID(self): return self.pid
    def GetState(self): return self.state

class Target:
    valid = True
    def __init__(self): self.process = Process()
    def IsValid(self): return self.valid
    def GetProcess(self): return self.process

class Debugger:
    valid = True
    identifier = 0
    def __init__(self): self.target = Target()
    def IsValid(self): return self.valid
    def GetID(self): return self.identifier
    def GetSelectedTarget(self): return self.target

def fresh():
    debug = Debugger()
    clock = [0.0]
    owner = module.OwnedObservation(lambda: clock[0])
    session, request = str(uuid.uuid4()), str(uuid.uuid4())
    expected = dict(protocolVersion=1, requestId=request, status='observed', debuggerId=0,
                    processInstance=1, pid=123)
    module.identity.query = lambda d, r: dict(expected, requestId=r)
    reply = owner.register(debug, session, request, expected, 30)
    assert reply['status'] == 'registered'
    def observe(d=debug, s=session, r=None, registration=reply['registrationId']):
        return owner.observe(d, s, r or str(uuid.uuid4()), registration)
    return owner, debug, clock, session, reply, observe

count = 0
for mode in ['live', 'exit', 'switch', 'pid-reuse', 'invalid', 'target-invalid', 'wrong-debugger',
             'wrong-session', 'wrong-request', 'wrong-registration', 'expired', 'unknown', 'release', 'duplicate']:
    owner, debug, clock, session, reply, observe = fresh()
    process = debug.target.process
    if mode == 'live': assert observe()['status'] == 'live'
    elif mode == 'exit':
        process.state = 3; assert observe()['status'] == 'exited'
    elif mode == 'switch':
        original = debug.target; debug.target = Target(); debug.target.process.instance = 2
        original.process.state = 3; assert observe()['status'] == 'exited'
    elif mode == 'release':
        assert owner.release(debug, session, str(uuid.uuid4()), reply['registrationId'])['status'] == 'released'
        assert process.state == 2
        assert observe()['status'] == 'unverifiable'
    elif mode == 'duplicate':
        assert owner.register(debug, session, str(uuid.uuid4()), {}, 30)['status'] == 'unverifiable'
        assert observe()['status'] == 'live'
    else:
        if mode == 'pid-reuse': process.instance = 2
        if mode == 'invalid': process.valid = False
        if mode == 'target-invalid': debug.target.valid = False
        if mode == 'expired': clock[0] = 30
        if mode == 'unknown': process.state = 99
        kwargs = {}
        if mode == 'wrong-debugger': kwargs['d'] = Debugger()
        if mode == 'wrong-session': kwargs['s'] = str(uuid.uuid4())
        if mode == 'wrong-request': kwargs['r'] = reply['requestId']
        if mode == 'wrong-registration': kwargs['registration'] = str(uuid.uuid4())
        assert observe(**kwargs)['status'] == 'unverifiable'
        assert observe()['status'] == 'unverifiable'
    count += 1
print(json.dumps({'passed': count}))
