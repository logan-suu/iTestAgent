import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Test-only owner/transport: fixed embedded recipient, never a caller-supplied PID.
// Does not relax the production transport's Xcode-only guard.
final class ReturnFixtureEnvironment: MemoryOwnedAppEnvironment {
    let bundleURL: URL
    let bundleIdentifier = "com.itestagent.return-transport-target"
    let request: String
    let directory: URL
    init(bundleURL: URL, request: String, directory: URL) {
        self.bundleURL = bundleURL; self.request = request; self.directory = directory
    }
    func hasExistingInstance() -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
    }
    func launch(_ completion: @escaping (NSRunningApplication?, Bool) -> Void) {
        guard !hasExistingInstance(), Bundle(url: bundleURL)?.bundleIdentifier == bundleIdentifier else {
            completion(nil, true); return
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        config.addsToRecentItems = false
        config.promptsUserIfNeeded = false
        config.createsNewApplicationInstance = true
        config.allowsRunningApplicationSubstitution = false
        config.environment = ["ITESTAGENT_RETURN_REQUEST": request,
                              "ITESTAGENT_RETURN_DIRECTORY": directory.path]
        NSWorkspace.shared.openApplication(at: bundleURL, configuration: config) { app, error in
            DispatchQueue.main.async { completion(app, error != nil) }
        }
    }
    func isExpected(_ app: NSRunningApplication) -> Bool {
        app.bundleIdentifier == bundleIdentifier && app.bundleURL?.standardizedFileURL == bundleURL.standardizedFileURL
    }
    func isTerminated(_ app: NSRunningApplication) -> Bool { app.isTerminated }
    func instancePresence(_ app: NSRunningApplication) -> MemoryOwnedAppPresence {
        let all = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
        if all.isEmpty { return .absent }
        return all.count == 1 && all[0].isEqual(app) ? .owned : .conflict
    }
    func mayTerminate(_ app: NSRunningApplication) -> Bool { isExpected(app) && instancePresence(app) == .owned }
    func terminate(_ app: NSRunningApplication) -> Bool { app.terminate() }
}

@main struct ReturnControllerMain {
    static func main() throws {
        let args = CommandLine.arguments
        if args.count == 2 && args[1] == "--preflight" {
            let result: [String: Any] = ["accessibilityTrusted": AXIsProcessTrusted(),
                "postEventAccess": CGPreflightPostEventAccess(), "eventsAttempted": false]
            let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
            FileHandle.standardOutput.write(data)
            return
        }
        // With no explicit run scope this App does not launch or post anything.
        guard args.count == 3, args[1] == "--authorized-fixture-run",
              ["normal", "cancel-before", "cancel-after-down"].contains(args[2]) else { exit(2) }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let controllers = NSRunningApplication.runningApplications(withBundleIdentifier: "com.itestagent.return-transport-controller")
        guard controllers.count == 1, controllers[0].isEqual(NSRunningApplication.current) else { exit(2) }
        let request = UUID().uuidString.lowercased()
        let directory = URL(fileURLWithPath: "/private/tmp/itestagent-return-run-" + request)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        let resultURL = directory.appendingPathComponent("controller.json")
        var exitStages: [String] = []
        func recordExitStage(_ stage: String) {
            exitStages.append(stage)
            let payload: [String: Any] = ["requestId": request, "stages": exitStages,
                "controllerPID": ProcessInfo.processInfo.processIdentifier]
            if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) {
                try? data.write(to: directory.appendingPathComponent("controller-exit.json"), options: .atomic)
            }
        }
        recordExitStage("initialized")
        let exitObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification, object: app, queue: .main
        ) { _ in
            // Delivery is synchronous on the explicitly selected main queue.
            MainActor.assumeIsolated { recordExitStage("will_terminate") }
        }
        defer { NotificationCenter.default.removeObserver(exitObserver) }
        func persist(_ value: [String: Any]) {
            var payload = value; payload["requestId"] = request; payload["mode"] = args[2]
            if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) {
                try? data.write(to: resultURL, options: .atomic)
            }
        }
        guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
            persist(["reason": "permission_unavailable", "downAttempted": false, "upAttempted": false,
                     "cleanupVerified": true]); return
        }
        guard let resources = Bundle.main.resourceURL else { exit(2) }
        let environment = ReturnFixtureEnvironment(bundleURL: resources.appendingPathComponent("iTestAgentReturnTarget.app"),
                                                    request: request, directory: directory)
        let deadline = ProcessInfo.processInfo.systemUptime + 15
        let session = MemoryOwnedAppSession(environment: environment, deadline: deadline)
        let driver = MemoryOwnedAppRunLoopDriver(session: session)
        var downAttempted = false; var upAttempted = false; var matched = false
        var resultReason = "not_observed"
        var pollTimer: Timer?
        var application: NSRunningApplication?
        var receiptDeadline: TimeInterval?
        driver.start(onAcquired: { owned in
            application = owned
            let timer = Timer(timeInterval: 0.05, repeats: true) { _ in
                guard session.state == .acquired else { return }
                guard environment.isExpected(owned), environment.instancePresence(owned) == .owned,
                      !owned.isTerminated else { resultReason = "owner_changed"; driver.close(); return }
                let now = ProcessInfo.processInfo.systemUptime
                let url = directory.appendingPathComponent("target.json")
                guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                      let size = attrs[.size] as? NSNumber, size.intValue <= 1024,
                      let data = try? Data(contentsOf: url),
                      let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      receipt["requestId"] as? String == request else { return }
                if receiptDeadline == nil {
                    guard owned.isActive, receipt["active"] as? Bool == true,
                          receipt["focused"] as? Bool == true,
                          receipt["downs"] as? Int == 0, receipt["ups"] as? Int == 0,
                          receipt["unexpected"] as? Bool == false else {
                        resultReason = "initial_context_changed"; driver.close(); return
                    }
                    receiptDeadline = now + 1
                    if args[2] == "cancel-before" { resultReason = "cancelled_before_send"; return }
                    guard AXIsProcessTrusted(), CGPreflightPostEventAccess(),
                          let down = CGEvent(keyboardEventSource: nil, virtualKey: 0x24, keyDown: true),
                          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0x24, keyDown: false),
                          environment.instancePresence(owned) == .owned, !owned.isTerminated, owned.isActive else {
                        resultReason = "send_preflight_failed"; driver.close(); return
                    }
                    down.flags = []; up.flags = []
                    downAttempted = true
                    down.postToPid(owned.processIdentifier)
                    // The cancel-after-down case performs only paired cleanup after this point.
                    resultReason = args[2] == "cancel-after-down" ? "cancelled_after_down" : "pair_posted"
                    if environment.instancePresence(owned) == .owned && !owned.isTerminated {
                        upAttempted = true
                        up.postToPid(owned.processIdentifier)
                    }
                    return
                }
                if let limit = receiptDeadline, now >= limit {
                    let count = args[2] == "cancel-before" ? 0 : 1
                    matched = receipt["downs"] as? Int == count && receipt["ups"] as? Int == count &&
                        receipt["unexpected"] as? Bool == false && receipt["repeated"] as? Bool == false
                    driver.close()
                }
            }
            pollTimer = timer; RunLoop.main.add(timer, forMode: .common)
        }, onClosed: { reason, clean in
            pollTimer?.invalidate()
            recordExitStage("owner_closed")
            persist(["reason": resultReason, "ownerReason": reason.rawValue, "cleanupVerified": clean,
                     "downAttempted": downAttempted, "upAttempted": upAttempted, "receiptMatched": matched,
                     "ownedPID": application?.processIdentifier ?? 0, "targetVerified": false])
            // stop() from this timer callback does not wake the NSEvent loop.
            // Request normal termination after writing the owned-target result.
            recordExitStage("termination_requested")
            app.terminate(nil)
            recordExitStage("terminate_returned")
        })
        withExtendedLifetime(driver) { app.run() }
        recordExitStage("run_returned")
    }
}
