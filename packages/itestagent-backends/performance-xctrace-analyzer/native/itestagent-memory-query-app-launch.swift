import AppKit
import Foundation

private final class MemoryAppQuerySnapshot: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Bool?
    func set(_ value: Bool) { lock.lock(); self.value = value; lock.unlock() }
    func get() -> Bool? { lock.lock(); defer { lock.unlock() }; return value }
}

// Compile-only adapter. No default entry point installs or invokes this launcher.
// The caller must verify the complete reviewed manifest before launch and on use.
final class MemoryQueryAppLaunch {
    private let bundleURL: URL
    private let bundleID: String
    private let manifestMatches: () -> Bool
    private let deadline: TimeInterval
    private var cancellation: MemoryIPCCancellation?
    private var started = false
    private(set) var launchInstanceId: String?
    private(set) var application: NSRunningApplication?
    private(set) var creationAttempted = false
    init(bundleURL: URL, bundleID: String, deadline: TimeInterval, manifestMatches: @escaping () -> Bool) {
        self.bundleURL = bundleURL; self.bundleID = bundleID; self.deadline = deadline; self.manifestMatches = manifestMatches
    }
    func launch(launcher: MemoryQueryLauncher, completion: @escaping (Bool) -> Void) {
        precondition(Thread.isMainThread)
        guard !started else { completion(false); return }; started = true
        do { try launcher.prepareControl(deadline: deadline) } catch { completion(false); return }
        cancellation = launcher.cancellation
        guard !launcher.cancellation.cancelled, deadline.isFinite, ProcessInfo.processInfo.systemUptime < deadline, bundleURL.isFileURL, bundleURL.standardizedFileURL == bundleURL.resolvingSymlinksInPath().standardizedFileURL,
              Bundle(url: bundleURL)?.bundleIdentifier == bundleID, manifestMatches(),
              NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).isEmpty
        else { completion(false); return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false; configuration.addsToRecentItems = false
        configuration.promptsUserIfNeeded = false; configuration.createsNewApplicationInstance = true
        configuration.allowsRunningApplicationSubstitution = false
        configuration.arguments = ["--memory-query-socket", launcher.endpoint.path, "--launcher-pid", String(getpid())]
        creationAttempted = true
        NSWorkspace.shared.openApplication(at: bundleURL, configuration: configuration) { app, error in
            DispatchQueue.main.async {
                self.application = app
                if app != nil { self.launchInstanceId = UUID().uuidString.lowercased() }
                completion(error == nil && self.isCurrent())
            }
        }
    }
    func isCurrent() -> Bool {
        precondition(Thread.isMainThread)
        guard cancellation?.cancelled != true, ProcessInfo.processInfo.systemUptime < deadline, let app = application, !app.isTerminated, manifestMatches(), app.bundleIdentifier == bundleID,
              app.bundleURL?.standardizedFileURL == bundleURL.standardizedFileURL else { return false }
        let instances = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
        return instances.count == 1 && instances[0].isEqual(app)
    }
    func bridge(_ launcher: MemoryQueryLauncher, manifestSHA256: String? = nil, completion: @escaping (Bool) -> Void) {
        precondition(Thread.isMainThread)
        guard isCurrent(), let original = application else { completion(false); return }
        let pid = original.processIdentifier
        let instance = launchInstanceId
        DispatchQueue.global(qos: .userInitiated).async {
            var closed = false
            do {
                try launcher.bridge(peerPID: pid, ownerCurrent: {
                    let snapshot = MemoryAppQuerySnapshot()
                    DispatchQueue.main.async { snapshot.set(self.application === original && self.isCurrent()) }
                    while !launcher.cancellation.cancelled && ProcessInfo.processInfo.systemUptime < self.deadline {
                        if let value = snapshot.get() { return value }
                        Thread.sleep(forTimeInterval: 0.01)
                    }
                    return false
                }, deadline: self.deadline, launchInstanceId: instance, manifestSHA256: manifestSHA256)
                closed = true
            } catch { launcher.cancellation.cancel() }
            let result = closed
            DispatchQueue.main.async { completion(result) }
        }
    }
    // Query/closed frames cannot authorize termination. The resource owner must close
    // its resources and exit normally; this adapter only observes the original App.
    var exitObserved: Bool { precondition(Thread.isMainThread); return application?.isTerminated == true }
}
