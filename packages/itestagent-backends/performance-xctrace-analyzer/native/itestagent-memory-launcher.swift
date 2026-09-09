import AppKit
import Foundation
import Darwin

// Only this launcher owns the new NSRunningApplication returned by its request.
signal(SIGPIPE, SIG_IGN)
let args = CommandLine.arguments
guard args.count == 6, let uuid = UUID(uuidString: args[2]), uuid.uuidString.lowercased() == args[2],
      let milliseconds = Int(args[5]), (100...30000).contains(milliseconds) else { exit(2) }
let request = args[2]
let appURL = URL(fileURLWithPath: args[1])
let directory = URL(fileURLWithPath: args[3])
func canonical(_ path: String) -> Bool {
    guard path.hasPrefix("/"), let resolved = realpath(path, nil) else { return false }
    defer { free(resolved) }
    return String(cString: resolved) == path
}
guard canonical(args[1]), canonical(args[3]),
      directory.lastPathComponent == "memory-request-" + request,
      args[4].hasPrefix("/"), let bundle = Bundle(url: appURL), let identifier = bundle.bundleIdentifier else { exit(2) }

func event(_ kind: String, _ fields: [String: Any] = [:]) {
    var value: [String: Any] = ["protocolVersion": 1, "requestId": request, "event": kind]
    for (key, field) in fields { value[key] = field }
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        let bytes = Array(data) + [UInt8(10)]
        _ = bytes.withUnsafeBytes { write(STDOUT_FILENO, $0.baseAddress, $0.count) }
    }
}
var application: NSRunningApplication?
var callbackReceived = false
var reason: String?
var stoppingAt: Double?
var forced = false
let start = ProcessInfo.processInfo.systemUptime
let deadline = start + Double(milliseconds) / 1000
func finish(_ closed: Bool, _ result: String) -> Never {
    event("closed", ["cleanupVerified": closed, "reason": result])
    exit(closed ? 0 : 1)
}
func stop(_ why: String) {
    if reason == nil { reason = why }
    if stoppingAt == nil { stoppingAt = ProcessInfo.processInfo.systemUptime }
    if let app = application, !app.isTerminated { _ = app.terminate() }
}
// EOF also covers ordinary parent exit. SIGKILL/system crashes are not claimed recoverable.
signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
term.setEventHandler { stop("cancelled") }
interrupt.setEventHandler { stop("cancelled") }
term.resume(); interrupt.resume()
DispatchQueue.global().async {
    var byte: UInt8 = 0
    while read(STDIN_FILENO, &byte, 1) > 0 {}
    DispatchQueue.main.async { stop("cancelled") }
}
if !NSRunningApplication.runningApplications(withBundleIdentifier: identifier).isEmpty {
    finish(true, "instance_conflict")
}
let configuration = NSWorkspace.OpenConfiguration()
configuration.activates = false
configuration.addsToRecentItems = false
configuration.promptsUserIfNeeded = false
configuration.createsNewApplicationInstance = true
configuration.allowsRunningApplicationSubstitution = false
configuration.arguments = ["--request", request, "--directory", directory.path, args[4]]
// Deferring dispatch lets an already pending cancellation prevent launch altogether.
DispatchQueue.main.async {
    if reason != nil { finish(true, "cancelled") }
    event("launch_requested")
    NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { app, error in
        DispatchQueue.main.async {
            callbackReceived = true
            application = app
            guard let app = app else { finish(true, reason ?? "launch_failed") }
            if app.isTerminated {
                event("launched", ["terminatedAtCallback": true])
                finish(true, reason ?? (error == nil ? "completed" : "launch_failed"))
            }
            event("launched", ["pid": Int(app.processIdentifier)])
            if error != nil || app.bundleURL?.resolvingSymlinksInPath() != appURL.resolvingSymlinksInPath() {
                stop("launch_failed")
            }
            if let why = reason { stop(why) }
        }
    }
}
let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now(), repeating: .milliseconds(25))
timer.setEventHandler {
    let now = ProcessInfo.processInfo.systemUptime
    if let app = application, app.isTerminated { finish(true, reason ?? "completed") }
    if now >= deadline { stop("timeout") }
    if let stopped = stoppingAt {
        if let app = application, !app.isTerminated, now - stopped >= 0.5, !forced {
            forced = true
            _ = app.forceTerminate()
        }
        // A missing callback cannot establish whether a late launch will occur.
        if now - stopped >= 5 { finish(false, callbackReceived ? "cleanup_failed" : "launch_unresolved") }
    }
}
timer.resume()
RunLoop.main.run()
