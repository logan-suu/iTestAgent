"""One isolated LLDB session, at most two self-exiting host processes."""
import sys
import json
import os
import uuid
import lldb
sys.dont_write_bytecode = True


def run_owned_observation(native, executable, output):
    sys.path.insert(0, native)
    import itestagent_memory_identity as identity
    from itestagent_memory_owned_observation import OwnedObservation
    debugger = lldb.debugger
    debugger.SetAsync(False)
    processes = []
    resumed = set()
    result = {'passed': False}
    def start(target):
        launch = lldb.SBLaunchInfo(None)
        launch.SetLaunchFlags(lldb.eLaunchFlagStopAtEntry)
        error = lldb.SBError()
        process = target.Launch(launch, error)
        if process.IsValid(): processes.append(process)
        if error.Fail() or not process.IsValid(): raise RuntimeError()
        return process
    def resume(process):
        key = process.GetUniqueID()
        if key in resumed: raise RuntimeError()
        resumed.add(key)
        if process.Continue().Fail(): raise RuntimeError()
        if process.GetState() != lldb.eStateExited: raise RuntimeError()
    try:
        first_target = debugger.CreateTarget(executable)
        debugger.SetSelectedTarget(first_target)
        first = start(first_target)
        session, request = str(uuid.uuid4()), str(uuid.uuid4())
        expected = identity.query(debugger, request)
        owner = OwnedObservation()
        registration = owner.register(debugger, session, request, expected, 30)
        assert registration['status'] == 'registered'
        def observe():
            return owner.observe(debugger, session, str(uuid.uuid4()), registration['registrationId'])
        second_target = debugger.CreateTarget(executable)
        debugger.SetSelectedTarget(second_target)
        result['selectedTargetChanged'] = debugger.GetSelectedTarget() == second_target
        result['originalLiveAfterSwitch'] = observe()['status'] == 'live'
        resume(first)
        result['originalExitAfterSwitch'] = observe()['status'] == 'exited'
        second = start(second_target)
        result['differentProcessInstance'] = second.GetUniqueID() != first.GetUniqueID()
        observed = observe()
        result['originalExitWhileSecondLive'] = observed['status'] == 'exited' and observed['processInstance'] == first.GetUniqueID()
        released = owner.release(debugger, session, str(uuid.uuid4()), registration['registrationId'])
        result['releaseOnlyDropsReference'] = released['status'] == 'released' and second.GetState() == lldb.eStateStopped
        result['releasedUnverifiable'] = observe()['status'] == 'unverifiable'
        resume(second)
        result['normalExits'] = all(p.GetState() == lldb.eStateExited for p in processes)
        result['passed'] = all(value for key, value in result.items() if key != 'passed') and len(processes) == 2
    except Exception:
        result['passed'] = False
    finally:
        for process in processes:
            if process.GetState() == lldb.eStateStopped and process.GetUniqueID() not in resumed:
                try: resume(process)
                except Exception: pass
        result['launchCount'] = len(processes)
        result['allOwnedExited'] = all(p.GetState() == lldb.eStateExited for p in processes)
        with open(output, 'x') as stream: json.dump(result, stream)
        # Never let LLDB shutdown kill unresolved inferiors. Preserve the owner for
        # investigation if its normal continuation did not complete.
        if not result['allOwnedExited']:
            import time
            while True: time.sleep(1)
