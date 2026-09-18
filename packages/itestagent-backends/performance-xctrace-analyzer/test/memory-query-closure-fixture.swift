import Foundation
import Darwin

// Real owned processes and sockets, synthetic launch owner. No AppKit application,
// AX interaction, Xcode, debugger, device, or physical identity is exercised.
@main struct ClosureFixture {
    static func main() { alarm(7); exit(run()) }
    static func run() -> Int32 {
        do {
            let args = CommandLine.arguments
            if args.count == 5, args[1] == "peer" {
                if args[4] == "forged-helper" || args[4] == "prepared-helper" {
                    let fd = try memoryIPCConnect(path: args[2], launcherPID: pid_t(args[3])!)
                    defer { Darwin.close(fd) }
                    let decoder = MemoryIPCDecoder(version: 4)
                    var hello: [String: Any]?
                    while hello == nil {
                        guard let data = try memoryIPCRead(fd) else { return 2 }
                        hello = try decoder.push(data).first
                    }
                    var frame = hello!; frame["sequence"] = 2
                    frame["kind"] = args[4] == "forged-helper" ? "launcher_closure" : "prepared"
                    if args[4] == "forged-helper" {
                        frame["scope"] = "no_target_resources"; frame["helper"] = "exited"
                        frame["manifestSHA256"] = String(repeating: "a", count: 64)
                        frame["launchInstanceId"] = UUID().uuidString.lowercased()
                    }
                    var bytes = try JSONSerialization.data(withJSONObject: frame); bytes.append(10)
                    try memoryIPCWrite(bytes, fd: fd, cancellation: MemoryIPCCancellation(), deadline: ProcessInfo.processInfo.systemUptime + 1)
                    return 0
                }
                if args[4] == "live-abort" { Thread.sleep(forTimeInterval: 0.3) }
                let session = MemoryHelperQuerySession(deadline: ProcessInfo.processInfo.systemUptime + 2, version: 4)
                var done = false; var safe = false
                session.start(path: args[2], launcherPID: pid_t(args[3])!) { safe = $0; done = true }
                while !done { RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01)) }
                return safe ? 0 : 2
            }
            let root = URL(fileURLWithPath: args[1])
            let mode = try String(contentsOf: root.appendingPathComponent("mode"), encoding: .utf8)
            if mode.hasPrefix("wire-") {
                let decoder = MemoryIPCDecoder(version: 4)
                var hello: [String: Any]?
                while hello == nil {
                    guard let bytes = try memoryIPCRead(STDIN_FILENO) else { return 2 }
                    hello = try decoder.push(bytes).first
                }
                if mode == "wire-oversize" { FileHandle.standardOutput.write(Data(repeating: 65, count: 32769)); return 0 }
                if mode == "wire-utf8" { FileHandle.standardOutput.write(Data([255, 10])); return 0 }
                if mode == "wire-empty" { FileHandle.standardOutput.write(Data([10])); return 0 }
                let instance = UUID().uuidString.lowercased()
                for (index, kind) in ["hello_ack", "closing", "closed", "launcher_closure"].enumerated() {
                    var frame = hello!; frame["kind"] = kind; frame["sequence"] = index + 2
                    frame["launchInstanceId"] = instance; frame["manifestSHA256"] = args[2]
                    if kind == "launcher_closure" { frame["scope"] = "no_target_resources"; frame["helper"] = "exited" }
                    if mode == "wire-version" { frame["protocolVersion"] = 3 }
                    if mode == "wire-prepared", index == 1 { frame["kind"] = "prepared" }
                    if mode == "wire-scope", index == 3 { frame["scope"] = "all_resources" }
                    if mode == "wire-sequence", index == 3 { frame["sequence"] = 9 }
                    if mode == "wire-boolean", index == 3 { frame["helper"] = true }
                    var bytes = try JSONSerialization.data(withJSONObject: frame); bytes.append(10)
                    if mode == "wire-truncated", index == 3 { bytes.removeLast() }
                    FileHandle.standardOutput.write(bytes)
                    if mode == "wire-duplicate", index == 3 { FileHandle.standardOutput.write(bytes) }
                }
                return 0
            }
            let deadline = ProcessInfo.processInfo.systemUptime + 3
            let launcher = try MemoryQueryLauncher(version: 4)
            let signals = MemoryIPCSignals(launcher.cancellation)
            defer { withExtendedLifetime(signals) {}; launcher.control?.stop() }
            try launcher.prepareControl(deadline: deadline)
            if mode == "late" { Thread.sleep(forTimeInterval: 0.3) }
            guard !launcher.cancellation.cancelled else { return 2 }
            let child = Process(); child.executableURL = URL(fileURLWithPath: args[0])
            child.arguments = ["peer", launcher.endpoint.path, String(getpid()), mode]
            child.standardInput = FileHandle.nullDevice; child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
            try child.run()
            let instance = UUID().uuidString.lowercased()
            var bridged = false
            do { try launcher.bridge(peerPID: child.processIdentifier, ownerCurrent: { child.isRunning }, deadline: deadline, launchInstanceId: instance, manifestSHA256: args[2]); bridged = true } catch {}
            // Even rejected helpers are reaped by their original fixture owner.
            while child.isRunning && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.01) }
            guard bridged, !child.isRunning, child.terminationStatus == 0, var closed = launcher.closedFrame else { return 2 }
            if mode == "missing" { return 0 }
            if mode == "wrong-session" { closed["sessionId"] = UUID().uuidString.lowercased() }
            if mode == "wrong-request" { closed["requestId"] = UUID().uuidString.lowercased() }
            if mode == "wrong-challenge" { closed["challenge"] = String(repeating: "b", count: 64) }
            let receipt = try MemoryLauncherClosure(original: child, launchInstanceId: mode == "wrong-instance" ? UUID().uuidString.lowercased() : instance,
                manifestSHA256: mode == "wrong-manifest" ? String(repeating: "f", count: 64) : args[2], closed: closed)
            if mode == "cancel" { launcher.cancellation.cancel() }
            let owner = mode == "wrong-owner" ? Process() : child
            try receipt.write(original: owner, exited: { mode != "unknown-exit" && !child.isRunning },
                manifestMatches: { mode != "changed-manifest" }, cancellation: launcher.cancellation, deadline: deadline)
            if mode == "reuse" {
                do { try receipt.write(original: child, exited: { true }, manifestMatches: { true }, cancellation: launcher.cancellation, deadline: deadline); return 9 }
                catch { return 0 }
            }
            if mode == "slow-exit" { Darwin.close(STDOUT_FILENO); Thread.sleep(forTimeInterval: 0.4) }
            if mode == "extra" { FileHandle.standardOutput.write(Data("{}\n".utf8)) }
            if mode == "partial" { FileHandle.standardOutput.write(Data("{".utf8)) }
            if mode == "stderr" { FileHandle.standardError.write(Data("fixture".utf8)) }
            return mode == "nonzero" ? 2 : 0
        } catch { return 2 }
    }
}
