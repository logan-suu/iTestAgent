import AppKit
import Foundation

protocol MemoryOwnedAppEnvironment {
    associatedtype Application
    func hasExistingInstance() -> Bool
    func launch(_ completion: @escaping (Application?, Bool) -> Void)
    func isExpected(_ app: Application) -> Bool
    func isTerminated(_ app: Application) -> Bool
    func instancePresence(_ app: Application) -> MemoryOwnedAppPresence
    func mayTerminate(_ app: Application) -> Bool
    func terminate(_ app: Application) -> Bool
}

enum MemoryOwnedAppPresence { case owned, absent, conflict }

enum MemoryOwnedAppState: String { case idle, launching, acquired, closing, closed }
enum MemoryOwnedAppReason: String {
    case completed, cancelled, timeout
    case conflict = "instance_conflict"
    case launchFailed = "launch_failed"
    case cleanupUnverified = "cleanup_unverified"
}

// Minted only by an acquired owner session; no PID-based constructor is exposed.
final class MemoryOwnedAppHandle<Application> {
    let sessionID: UUID
    let application: Application
    private let current: () -> Bool
    private let observable: () -> Bool
    private let terminated: () -> Bool
    fileprivate init(sessionID: UUID, application: Application, current: @escaping () -> Bool,
                     observable: @escaping () -> Bool, terminated: @escaping () -> Bool) {
        self.sessionID = sessionID; self.application = application; self.current = current
        self.observable = observable; self.terminated = terminated
    }
    func isCurrent() -> Bool { precondition(Thread.isMainThread); return current() }
    // Read-only cleanup observations may outlive work cancellation, but may not
    // extend the original owner or its independent bounded cleanup deadline.
    func canObserve() -> Bool { precondition(Thread.isMainThread); return observable() }
    // Only the owning state machine can establish this terminal observation.
    // Neither PID disappearance nor a successful Quit request mints evidence.
    func originalProcessExitObserved() -> Bool {
        precondition(Thread.isMainThread); return terminated()
    }
}

// Launch ownership only, not debugger/AUT cleanup or capture readiness. The enclosing
// driver must retain the global lease until all session resources are verified closed.
// All entry points run on the main thread; tick runs from a main-run-loop timer.
final class MemoryOwnedAppSession<E: MemoryOwnedAppEnvironment> {
    private let environment: E
    private let deadline: TimeInterval
    private let now: () -> TimeInterval
    private let cleanupTimeout: TimeInterval
    private var closeDeadline: TimeInterval?
    private var queryHandle: MemoryOwnedAppHandle<E.Application>?
    private var callbackReceived = false
    private var terminateRequested = false
    private var continuityLost = false
    private var originalExitObserved = false
    private(set) var application: E.Application?
    private(set) var state = MemoryOwnedAppState.idle
    private(set) var reason: MemoryOwnedAppReason?
    private(set) var cleanupVerified = false

    init(environment: E, deadline: TimeInterval, cleanupTimeout: TimeInterval = 5,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.environment = environment
        self.deadline = deadline
        self.cleanupTimeout = cleanupTimeout.isFinite && (0.1...5).contains(cleanupTimeout) ? cleanupTimeout : 5
        self.now = now
    }

    func ownedHandle(sessionID: UUID) -> MemoryOwnedAppHandle<E.Application>? {
        precondition(Thread.isMainThread)
        guard state == .acquired, now() < deadline, let app = application,
              environment.isExpected(app), !environment.isTerminated(app),
              environment.instancePresence(app) == .owned else { return nil }
        if let handle = queryHandle { return handle.sessionID == sessionID ? handle : nil }
        let handle = MemoryOwnedAppHandle(sessionID: sessionID, application: app, current: { [weak self] in
            guard let self, self.state == .acquired, self.now() < self.deadline else { return false }
            let identityValid = self.environment.isExpected(app) && self.environment.instancePresence(app) != .conflict
            if !identityValid { self.continuityLost = true }
            return identityValid && !self.environment.isTerminated(app) &&
                self.environment.instancePresence(app) == .owned
        }, observable: { [weak self] in
            guard let self else { return false }
            let limit: Double
            if self.state == .acquired { limit = self.deadline }
            else if self.state == .closing, let cleanup = self.closeDeadline { limit = cleanup }
            else { return false }
            guard self.now() < limit else { return false }
            let identityValid = self.environment.isExpected(app) && self.environment.instancePresence(app) != .conflict
            if !identityValid { self.continuityLost = true }
            return identityValid && !self.environment.isTerminated(app) &&
                self.environment.instancePresence(app) == .owned
        }, terminated: { [weak self] in
            guard let self else { return false }
            return self.state == .closed && self.originalExitObserved && !self.continuityLost
        })
        queryHandle = handle
        return handle
    }

    func start() {
        precondition(Thread.isMainThread)
        guard state == .idle else { return }
        guard deadline.isFinite, now() < deadline else { finish(true, .timeout); return }
        guard !environment.hasExistingInstance() else { finish(true, .conflict); return }
        state = .launching
        environment.launch { app, failed in
            precondition(Thread.isMainThread)
            // A result after the close deadline cannot revise an already reported
            // unresolved launch. Retain the lease; never adopt or act on a late app.
            guard self.state != .closed, !self.callbackReceived else { return }
            self.callbackReceived = true
            self.application = app
            guard let app = app else { self.finish(true, self.reason ?? .launchFailed); return }
            if self.environment.isTerminated(app) {
                self.finish(true, self.reason ?? (failed ? .launchFailed : .completed)); return
            }
            guard self.environment.isExpected(app) else {
                self.finish(false, .cleanupUnverified); return
            }
            let presence = self.environment.instancePresence(app)
            guard presence != .conflict else { self.finish(false, .conflict); return }
            if self.now() >= self.deadline { self.close(.timeout) }
            if failed { self.close(.launchFailed) }
            if self.state != .closing, presence == .owned { self.state = .acquired }
            // Cleanup happens on the next run-loop tick, not recursively in callback.
        }
    }

    func close(_ why: MemoryOwnedAppReason = .completed) {
        precondition(Thread.isMainThread)
        guard state != .closed else { return }
        if reason == nil { reason = why }
        if state == .idle { finish(true, reason ?? why); return }
        state = .closing
        if closeDeadline == nil { closeDeadline = now() + cleanupTimeout }
    }

    func tick() {
        precondition(Thread.isMainThread)
        guard state != .idle, state != .closed else { return }
        if continuityLost { finish(false, .conflict); return }
        if now() >= deadline { close(.timeout) }
        if let app = application {
            if !environment.isExpected(app) || environment.instancePresence(app) == .conflict {
                continuityLost = true
                finish(false, .conflict); return
            }
            if environment.isTerminated(app) {
                let limit = closeDeadline ?? deadline
                originalExitObserved = queryHandle != nil && !continuityLost && now() < limit
                finish(true, reason ?? .completed); return
            }
            let presence = environment.instancePresence(app)
            guard presence != .conflict else { finish(false, .conflict); return }
            // Inventory and per-instance exit observations need not update together.
            // After a sent exit request, only observe; never repeat the mutation.
            if state == .closing, terminateRequested {
                if let limit = closeDeadline, now() >= limit { finish(false, .cleanupUnverified) }
                return
            }
            guard environment.isExpected(app) else { finish(false, .conflict); return }
            if presence == .absent {
                guard state == .launching || state == .closing else { finish(false, .conflict); return }
                if state == .closing, let limit = closeDeadline, now() >= limit {
                    finish(false, .cleanupUnverified)
                }
                return
            }
            if state == .launching, callbackReceived { state = .acquired }
        }
        if state == .closing {
            guard let limit = closeDeadline, now() < limit else { finish(false, .cleanupUnverified); return }
            guard callbackReceived, let app = application else { return }
            guard environment.mayTerminate(app) else { finish(false, .cleanupUnverified); return }
            // The close-proof read may itself take time. Revalidate before mutation.
            guard now() < limit, environment.isExpected(app), environment.instancePresence(app) == .owned else {
                finish(false, .cleanupUnverified); return
            }
            if !terminateRequested {
                terminateRequested = true
                if !environment.terminate(app) { finish(false, .cleanupUnverified) }
            }
        }
    }

    private func finish(_ verified: Bool, _ why: MemoryOwnedAppReason) {
        guard state != .closed else { return }
        cleanupVerified = verified
        reason = why
        state = .closed
    }
}

// The timer intentionally retains the driver until a terminal result, so dropping
// a caller reference cannot silently abandon an outstanding launch. No blocking
// sleep/poll loop is used; AppKit receives main-run-loop progress between ticks.
final class MemoryOwnedAppRunLoopDriver<E: MemoryOwnedAppEnvironment> {
    let session: MemoryOwnedAppSession<E>
    private var timer: Timer?
    private var started = false
    private var acquiredReported = false
    private var closedReported = false

    init(session: MemoryOwnedAppSession<E>) { self.session = session }

    func start(onAcquired: @escaping (E.Application) -> Void,
               onClosed: @escaping (MemoryOwnedAppReason, Bool) -> Void) {
        precondition(Thread.isMainThread)
        guard !started else { return }
        started = true
        session.start()
        let timer = Timer(timeInterval: 0.025, repeats: true) { _ in
            self.session.tick()
            if self.session.state == .acquired, !self.acquiredReported,
               let app = self.session.application {
                self.acquiredReported = true
                onAcquired(app)
            }
            if self.session.state == .closed, !self.closedReported {
                self.closedReported = true
                self.timer?.invalidate()
                self.timer = nil
                onClosed(self.session.reason ?? .cleanupUnverified, self.session.cleanupVerified)
            }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func cancel() { session.close(.cancelled) }
    func close() { session.close() }
}

// This adapter never opens documents, runs a scheme, requests trust, or force-quits.
// The caller's termination proof must independently reject unknown windows and
// outstanding debugger/AUT resources. A launch result alone is never that proof.
struct PublicMemoryOwnedAppEnvironment: MemoryOwnedAppEnvironment {
    let bundleURL: URL
    let bundleIdentifier: String
    let safeToTerminate: (NSRunningApplication) -> Bool

    func hasExistingInstance() -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
    }
    func launch(_ completion: @escaping (NSRunningApplication?, Bool) -> Void) {
        guard bundleURL.isFileURL,
              Bundle(url: bundleURL)?.bundleIdentifier == bundleIdentifier,
              !hasExistingInstance() else { completion(nil, true); return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        configuration.promptsUserIfNeeded = false
        configuration.createsNewApplicationInstance = true
        configuration.allowsRunningApplicationSubstitution = false
        NSWorkspace.shared.openApplication(at: bundleURL, configuration: configuration) { app, error in
            DispatchQueue.main.async { completion(app, error != nil) }
        }
    }
    func isExpected(_ app: NSRunningApplication) -> Bool {
        app.bundleIdentifier == bundleIdentifier &&
        app.bundleURL?.resolvingSymlinksInPath().standardizedFileURL == bundleURL.resolvingSymlinksInPath().standardizedFileURL
    }
    func isTerminated(_ app: NSRunningApplication) -> Bool { app.isTerminated }
    func instancePresence(_ app: NSRunningApplication) -> MemoryOwnedAppPresence {
        let instances = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
        if instances.isEmpty { return .absent }
        return instances.count == 1 && instances[0].isEqual(app) ? .owned : .conflict
    }
    func mayTerminate(_ app: NSRunningApplication) -> Bool { safeToTerminate(app) }
    func terminate(_ app: NSRunningApplication) -> Bool { app.terminate() }
}

// A retained owner-local observation, not a disk ownership or complete-lease
// proof. The caller must associate its observed document set before owner exit.
final class MemoryDocumentProcessLifetime<Application> {
    private let owner: MemoryOwnedAppHandle<Application>
    let sessionID: UUID
    init?(owner: MemoryOwnedAppHandle<Application>) {
        guard owner.isCurrent() else { return nil }
        self.owner = owner; sessionID = owner.sessionID
    }
    var closureSource: String? {
        owner.originalProcessExitObserved() ? "owner_process_exited" : nil
    }
}
