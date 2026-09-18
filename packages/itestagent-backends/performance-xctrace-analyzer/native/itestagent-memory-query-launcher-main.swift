import AppKit
import Foundation
import Darwin

// This candidate is staged unsigned and is not a production capture entry point.
@main struct MemoryQueryLauncherMain {
    static func main() {
        let args = CommandLine.arguments
        guard args.count == 3 else { exit(2) }
        #if MEMORY_QUERY_CLOSURE_V4
        let version = 4
        #else
        let version = 3
        #endif
        let candidate = MemoryQueryCandidate(root: URL(fileURLWithPath: args[1]), expectedDigest: args[2], version: version)
        guard candidate.matches() else { exit(2) }
        do {
            let deadline = ProcessInfo.processInfo.systemUptime + 150
            let launcher = try MemoryQueryLauncher(version: version)
            let signals = MemoryIPCSignals(launcher.cancellation)
            let owner = MemoryQueryAppLaunch(bundleURL: candidate.root.appendingPathComponent("iTestAgentMemoryQueryHelper.app"),
                bundleID: "com.itestagent.memory-query-helper", deadline: deadline, manifestMatches: { candidate.matches() })
            var callback = false; var bridgeFinished = false; var protocolClosed = false; var timer: Timer?
            owner.launch(launcher: launcher) { acquired in
                callback = true
                if acquired { owner.bridge(launcher, manifestSHA256: candidate.expectedDigest) { protocolClosed = $0; bridgeFinished = true } }
                else { bridgeFinished = true; launcher.cancellation.cancel() }
            }
            timer = Timer.scheduledTimer(withTimeInterval: 0.025, repeats: true) { _ in
                if let code = memoryQueryLauncherExitCode(callbackReceived: callback, bridgeFinished: bridgeFinished,
                    protocolClosed: protocolClosed, helperExited: owner.exitObserved, creationAttempted: owner.creationAttempted) {
                    var finalCode = code
                    #if MEMORY_QUERY_CLOSURE_V4
                    if code == 0 {
                        do {
                            guard let frame = launcher.closedFrame, let instance = owner.launchInstanceId,
                                  !launcher.cancellation.cancelled, launcher.control?.pendingBytes == 0,
                                  candidate.matches() else { throw MemoryIPCError.invalid }
                            let receipt = try MemoryLauncherClosure(original: owner, launchInstanceId: instance,
                                manifestSHA256: candidate.expectedDigest, closed: frame)
                            try receipt.write(original: owner, exited: { owner.exitObserved },
                                manifestMatches: { candidate.matches() }, cancellation: launcher.cancellation, deadline: deadline)
                        } catch { finalCode = 2 }
                    }
                    #endif
                    timer?.invalidate(); launcher.control?.stop(); launcher.endpoint.cleanup()
                    withExtendedLifetime(signals) {}; exit(finalCode)
                }
                if ProcessInfo.processInfo.systemUptime >= deadline {
                    launcher.cancellation.cancel(); launcher.control?.stop()
                    // Unknown downstream ownership retains the enclosing TS lease.
                    // No force termination and no fabricated helper-exit proof.
                    withExtendedLifetime(signals) {}; exit(2)
                }
            }
            RunLoop.main.run()
        } catch { exit(2) }
    }
}
