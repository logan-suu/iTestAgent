import AppKit
import Foundation
import Darwin

@main struct MemoryQueryHelperMain {
    static func main() {
        let args = CommandLine.arguments
        guard args.count == 5, args[1] == "--memory-query-socket", args[3] == "--launcher-pid",
              let pid = pid_t(args[4]), pid > 0 else { exit(2) }
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        // Deliberately no production provider: physical generation and complete
        // downstream closure sources are unavailable. No Xcode/AX/events are used.
        #if MEMORY_QUERY_CLOSURE_V4
        let session = MemoryHelperQuerySession(deadline: ProcessInfo.processInfo.systemUptime + 150, version: 4)
        #else
        let session = MemoryHelperQuerySession(deadline: ProcessInfo.processInfo.systemUptime + 150)
        #endif
        let signals = MemoryIPCSignals(session.cancellation)
        session.start(path: args[2], launcherPID: pid) { safeToExit in
            if safeToExit { app.terminate(nil) }
        }
        withExtendedLifetime((session, signals)) { app.run() }
    }
}
