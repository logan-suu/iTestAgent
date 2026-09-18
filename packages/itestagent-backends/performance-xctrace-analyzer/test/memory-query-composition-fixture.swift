import Foundation
import Darwin

// Synthetic provider only; no NSApplication, AX, Return transport or device is used.
final class CompositionProvider: MemoryHelperQueryProvider {
    private let mode: String
    private var hello: [String: Any]?
    private var used = false
    var resourcesClosed: Bool { mode != "missing-closure" }
    init(mode: String) { self.mode = mode }
    func prepare(hello: [String: Any]) throws -> [[String: Any]] {
        self.hello = hello
        var ack = hello; ack["kind"] = "hello_ack"; ack["sequence"] = 2
        var ready = hello; ready["kind"] = "prepared"; ready["sequence"] = 3
        return [ack, ready]
    }
    func execute(decision: [String: Any], completed: @escaping (String?) -> Void) {
        precondition(!used); used = true
        guard decision["effect"] as? String == "allow", let hello else { completed(nil); return }
        let observation: [String: Any] = ["protocolVersion": 1, "requestId": hello["requestId"]!, "status": "observed",
            "debuggerId": 0, "processInstance": 1, "pid": 123, "moduleUUID": String(repeating: "a", count: 32),
            "triple": "arm64-apple-ios", "platform": "fixture", "executable": "/fixture/app"]
        let line = "ITESTAGENT_MEMORY_IDENTITY " + String(decoding: try! JSONSerialization.data(withJSONObject: observation), as: UTF8.self)
        let envelope: [String: Any] = ["protocolVersion": 1, "sessionId": hello["sessionId"]!, "requestId": hello["requestId"]!,
            "strategy": hello["strategy"]!, "commandSHA256": hello["commandSHA256"]!, "status": "candidate",
            "insertionAttempted": true, "downAttempted": true, "upAttempted": true, "candidateLine": line]
        completed(String(decoding: try! JSONSerialization.data(withJSONObject: envelope), as: UTF8.self))
    }
    func cancel() {}
}
@main struct CompositionFixture {
    static func main() { alarm(8); exit(run()) }
    static func run() -> Int32 {
        do {
            let args = CommandLine.arguments
            if args.count == 5, args[1] == "peer" {
                let provider = args[4] == "unsupported" ? nil : CompositionProvider(mode: args[4])
                let session = MemoryHelperQuerySession(deadline: ProcessInfo.processInfo.systemUptime + 1, provider: provider)
                let signals = MemoryIPCSignals(session.cancellation)
                var complete = false; var closed = false
                session.start(path: args[2], launcherPID: pid_t(args[3])!) { safe in complete = true; closed = safe }
                while !complete { RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01)) }
                withExtendedLifetime((session, signals)) {}; return closed ? 0 : 3
            }
            let launcher = try MemoryQueryLauncher()
            let signals = MemoryIPCSignals(launcher.cancellation)
            defer { withExtendedLifetime(signals) {} }
            let child = Process(); child.executableURL = URL(fileURLWithPath: args[0])
            child.arguments = ["peer", launcher.endpoint.path, String(getpid()), args[1]]
            child.standardInput = FileHandle.nullDevice; child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
            let deadline = ProcessInfo.processInfo.systemUptime + 3
            try launcher.prepareControl(deadline: deadline)
            guard !launcher.cancellation.cancelled else { return 2 }
            try child.run()
            var closed = false
            do { try launcher.bridge(peerPID: child.processIdentifier, ownerCurrent: {child.isRunning}, deadline: deadline); closed = true } catch {}
            while child.isRunning && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.01) }
            return closed && !child.isRunning && child.terminationStatus == 0 ? 0 : 2
        } catch { return 2 }
    }
}
