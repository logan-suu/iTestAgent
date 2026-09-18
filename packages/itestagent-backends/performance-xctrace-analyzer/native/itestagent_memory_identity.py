"""Fixed metadata-only query for the owning debugger; never evaluate target expressions."""
import json
import re
import uuid


def query(debugger, request_id):
    import lldb

    blocked = {"protocolVersion": 1, "requestId": request_id,
               "status": "unverifiable"}
    try:
        if str(uuid.UUID(request_id)) != request_id:
            return {"protocolVersion": 1, "status": "invalid_request"}
        target = debugger.GetSelectedTarget()
        if not target.IsValid():
            return blocked
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() not in (lldb.eStateRunning, lldb.eStateStopped):
            return blocked
        info = process.GetProcessInfo()
        if not info.IsValid() or info.GetProcessID() != process.GetProcessID():
            return blocked
        executable = target.GetExecutable()
        module = target.FindModule(executable)
        if not executable.IsValid() or not module.IsValid():
            return blocked
        module_uuid = module.GetUUIDString()
        triple = target.GetTriple()
        platform = target.GetPlatform()
        remote_file = info.GetExecutableFile()
        remote_path = remote_file.fullpath if remote_file.IsValid() else None
        if (not module_uuid or not re.fullmatch(r"[a-fA-F0-9-]{32,40}", module_uuid)
                or not triple or len(triple) > 256 or not platform.IsValid()
                or not remote_path or not remote_path.startswith("/") or len(remote_path) > 4096
                or any(ord(c) < 32 for c in remote_path)
                or process.GetUniqueID() <= 0 or process.GetProcessID() <= 0):
            return blocked
        # Recheck selected target and live process after collecting metadata.
        current = debugger.GetSelectedTarget().GetProcess()
        if (not current.IsValid() or current.GetUniqueID() != process.GetUniqueID()
                or current.GetProcessID() != process.GetProcessID()
                or current.GetState() not in (lldb.eStateRunning, lldb.eStateStopped)):
            return blocked
        return {"protocolVersion": 1, "requestId": request_id, "status": "observed",
                "debuggerId": debugger.GetID(), "processInstance": process.GetUniqueID(),
                "pid": process.GetProcessID(), "moduleUUID": module_uuid.lower(),
                "triple": triple, "platform": platform.GetName(), "executable": remote_path}
    except Exception:
        # No arbitrary debugger diagnostics, paths or target output on failure.
        return blocked


def emit(debugger, request_id):
    print("ITESTAGENT_MEMORY_IDENTITY " + json.dumps(query(debugger, request_id),
                                                     sort_keys=True, separators=(",", ":")))


def query_exit(debugger, request_id, debugger_id, process_instance, pid):
    """Observe only the exact previously seen SBProcess; never infer exit from absence."""
    import lldb
    blocked = {"protocolVersion": 1, "requestId": request_id, "status": "unverifiable"}
    try:
        if (str(uuid.UUID(request_id)) != request_id
                or any(type(value) is not int or value < minimum or value > 9007199254740991
                       for value, minimum in ((debugger_id, 0), (process_instance, 1), (pid, 1)))):
            return {"protocolVersion": 1, "status": "invalid_request"}
        if debugger.GetID() != debugger_id:
            return blocked
        target = debugger.GetSelectedTarget()
        if not target.IsValid():
            return blocked
        process = target.GetProcess()
        if (not process.IsValid() or process.GetUniqueID() != process_instance
                or process.GetProcessID() != pid or process.GetState() != lldb.eStateExited):
            return blocked
        current = debugger.GetSelectedTarget().GetProcess()
        if (debugger.GetID() != debugger_id or not current.IsValid()
                or current.GetUniqueID() != process_instance or current.GetProcessID() != pid
                or current.GetState() != lldb.eStateExited):
            return blocked
        return {"protocolVersion": 1, "requestId": request_id, "status": "observed_exited",
                "debuggerId": debugger_id, "processInstance": process_instance, "pid": pid,
                "source": "lldb_selected_process_exited"}
    except Exception:
        return blocked


def emit_exit(debugger, request_id, debugger_id, process_instance, pid):
    print("ITESTAGENT_MEMORY_EXIT " + json.dumps(
        query_exit(debugger, request_id, debugger_id, process_instance, pid),
        sort_keys=True, separators=(",", ":")))
