import Foundation
import Darwin

// Own Process is the fake App owner. No AppKit, Xcode, AX, CGEvent or device calls run.
@main struct Fixture {
    static func main() { alarm(12); exit(run()) }
    static func run() -> Int32 {
        do {
            let args = CommandLine.arguments
            if args.count >= 2, args[1] == "peer" {
                try peer(path: args[2], launcher: pid_t(args[3])!, mode: args[4]); return 0
            }
            let mode = args.count > 1 ? args[1] : "normal"
            if mode == "protocol-policy" { try protocolPolicy(); return 0 }
            let launcher = try MemoryQueryLauncher()
            let signals = MemoryIPCSignals(launcher.cancellation)
            defer { withExtendedLifetime(signals) {} }
            if mode == "endpoint-replaced" {
                unlink(launcher.endpoint.path)
                symlink("/dev/null", launcher.endpoint.path)
                do { try launcher.endpoint.validate(); return 90 } catch { unlink(launcher.endpoint.path); rmdir(launcher.endpoint.directory); return 0 }
            }
            if mode == "directory-replaced" {
                let old = launcher.endpoint.directory + "-original"
                guard rename(launcher.endpoint.directory, old) == 0 else { return 90 }
                mkdir(launcher.endpoint.directory, 0o700)
                defer { rmdir(launcher.endpoint.directory); unlink(old + "/channel"); rmdir(old) }
                do { try launcher.endpoint.validate(); return 90 } catch { return 0 }
            }
            let child = Process()
            child.executableURL = URL(fileURLWithPath: args[0])
            child.arguments = ["peer",launcher.endpoint.path,String(getpid()),mode]
            child.standardInput = FileHandle.nullDevice
            child.standardOutput = FileHandle.nullDevice
            child.standardError = FileHandle.standardError
            try child.run()
            let deadline = ProcessInfo.processInfo.systemUptime + 6
            var verified = false
            do {
                try launcher.bridge(peerPID: mode == "wrong-pid" ? getpid() : child.processIdentifier,
                    ownerCurrent: { child.isRunning && mode != "owner-changed" }, deadline: deadline)
                verified = true
            } catch { FileHandle.standardError.write(Data("bridge: \(error)\n".utf8)); launcher.cancellation.cancel() }
            // The bridge closes only the owned socket. The fake peer exits on EOF;
            // observe that exit, without signal escalation or killing a resource owner.
            while child.isRunning && ProcessInfo.processInfo.systemUptime < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
            guard !child.isRunning else { return 3 }
            return verified && child.terminationStatus == 0 ? 0 : 2
        } catch { FileHandle.standardError.write(Data("fixture: \(error)\n".utf8)); return 2 }
    }
    static func protocolPolicy() throws {
        for callback in [false, true] {
            for bridge in [false, true] {
                for closed in [false, true] {
                    for exited in [false, true] {
                        for attempted in [false, true] {
                            let actual = memoryQueryLauncherExitCode(callbackReceived: callback, bridgeFinished: bridge,
                                protocolClosed: closed, helperExited: exited, creationAttempted: attempted)
                            if !callback || !bridge || (!exited && attempted) { precondition(actual == nil) }
                            else { precondition(actual == (closed && exited ? 0 : 2)) }
                        }
                    }
                }
            }
        }
        // The original timer condition would exit with failure at this checkpoint.
        precondition(memoryQueryLauncherExitCode(callbackReceived: true, bridgeFinished: false,
            protocolClosed: false, helperExited: true, creationAttempted: true) == nil)
        precondition(memoryQueryLauncherExitCode(callbackReceived: true, bridgeFinished: true,
            protocolClosed: true, helperExited: true, creationAttempted: true) == 0)
        let hello: [String: Any] = ["protocolVersion": 3, "sequence": 1, "kind": "hello",
            "sessionId": UUID().uuidString.lowercased(), "requestId": UUID().uuidString.lowercased(),
            "strategy": "pidReturn", "commandSHA256": String(repeating: "a", count: 64),
            "challenge": String(repeating: "b", count: 64)]
        let line = try MemoryIPCDecoder.encode(hello)
        let decoder = MemoryIPCDecoder()
        for byte in line.dropLast() { let frames = try decoder.push(Data([byte])); precondition(frames.isEmpty) }
        let frames = try decoder.push(Data([10])); precondition(frames.count == 1); try decoder.end()
        for invalid in [Data([255, 10]), Data(repeating: 97, count: 32769), Data("{}\n".utf8)] {
            let parser = MemoryIPCDecoder()
            do { _ = try parser.push(invalid); preconditionFailure("Invalid frame accepted") } catch {}
            do { _ = try parser.push(line); preconditionFailure("Poisoned parser reused") } catch {}
        }
        let partial = MemoryIPCDecoder(); _ = try partial.push(Data(line.dropLast()))
        do { try partial.end(); preconditionFailure("Truncated frame accepted") } catch {}
        for mode in ["duplicate", "early-result", "extra", "wrong-id", "deny-result"] {
            let order = MemoryIPCOrder(deadline: ProcessInfo.processInfo.systemUptime + 5)
            try order.accept(hello, parent: true)
            var ack = hello; ack["kind"] = "hello_ack"; ack["sequence"] = 2
            try order.accept(ack, parent: false)
            var frame = hello; frame["sequence"] = 3; frame["kind"] = "prepared"
            if mode == "deny-result" {
                try order.accept(frame, parent: false)
                frame["sequence"] = 4; frame["kind"] = "decision"; frame["effect"] = "deny"
                try order.accept(frame, parent: true)
                frame.removeValue(forKey: "effect"); frame["sequence"] = 5; frame["kind"] = "result"; frame["result"] = "fake"
            }
            if mode == "duplicate" { frame = ack }
            if mode == "extra" { frame["extra"] = true }
            if mode == "wrong-id" { frame["requestId"] = UUID().uuidString.lowercased() }
            if mode == "early-result" { frame["kind"] = "result"; frame["result"] = "fake" }
            do { try order.accept(frame, parent: false); preconditionFailure("Invalid order accepted") } catch {}
            precondition(order.state == "failed")
        }
    }
    static func peer(path: String, launcher: pid_t, mode: String) throws {
        let fd = try memoryIPCConnect(path: path, launcherPID: launcher)
        defer { Darwin.close(fd) }
        if mode == "wrong-uid" {
            do { try memoryIPCPeer(fd,expectedPID:launcher,expectedUID:getuid()+1); exit(90) }
            catch { return }
        }
        let cancellation = MemoryIPCCancellation()
        let signals = MemoryIPCSignals(cancellation)
        defer { withExtendedLifetime(signals) {} }
        let deadline = ProcessInfo.processInfo.systemUptime + 5
        let decoder = MemoryIPCDecoder(); let order = MemoryIPCOrder(deadline: deadline)
        while true {
            var pending = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            guard ProcessInfo.processInfo.systemUptime < deadline else { throw MemoryIPCError.expired }
            if poll(&pending, 1, 20) <= 0 { continue }
            guard let bytes = try memoryIPCRead(fd) else { return }
            for frame in try decoder.push(bytes) {
                try order.accept(frame, parent: true)
                func send(_ kind: String, _ sequence: Int, _ result: String? = nil) throws {
                    var response = frame; response.removeValue(forKey: "effect")
                    response["kind"] = kind; response["sequence"] = sequence
                    if let result { response["result"] = result }
                    try order.accept(response, parent: false)
                    try memoryIPCWrite(MemoryIPCDecoder.encode(response), fd: fd, cancellation: cancellation, deadline: deadline)
                }
                if frame["kind"] as? String == "hello" {
                    try send("hello_ack",2); try send("prepared",3)
                    if mode == "eof-pending" { return }
                    if mode == "partial" { try memoryIPCWrite(Data("{".utf8),fd:fd,cancellation:cancellation,deadline:deadline);return }
                } else {
                    if mode == "after-grant" { return }
                    var sequence = 5
                    if frame["effect"] as? String == "allow" {
                        try send("result",sequence,"offline-fake-query"); sequence += 1
                    }
                    try send("closing",sequence);try send("closed",sequence+1);return
                }
            }
        }
    }
}
