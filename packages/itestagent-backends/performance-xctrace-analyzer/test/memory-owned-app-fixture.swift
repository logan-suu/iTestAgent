import AppKit
import Foundation
import Darwin

final class OwnedAppFixture: MemoryOwnedAppEnvironment {
    var existing = false
    var expected = true
    var unique = true
    var absent = false
    var exited = false
    var safe = true
    var acceptsTermination = true
    var launches = 0
    var terminations = 0
    var callback: ((Int?, Bool) -> Void)?
    func hasExistingInstance() -> Bool { existing }
    func launch(_ completion: @escaping (Int?, Bool) -> Void) { launches += 1; callback = completion }
    func isExpected(_ app: Int) -> Bool { expected }
    func isTerminated(_ app: Int) -> Bool { exited }
    func instancePresence(_ app: Int) -> MemoryOwnedAppPresence { absent ? .absent : (unique ? .owned : .conflict) }
    func mayTerminate(_ app: Int) -> Bool { safe }
    func terminate(_ app: Int) -> Bool { terminations += 1; return acceptsTermination }
}

// Fixed, bounded host-fixture diagnostics only; no window text or application output.
final class ObservedOwnedAppEnvironment: MemoryOwnedAppEnvironment {
    let base: PublicMemoryOwnedAppEnvironment
    private var events: [String] = []
    init(_ base: PublicMemoryOwnedAppEnvironment) { self.base = base }
    var diagnostic: String { events.joined(separator: ";") }
    private func record(_ event: String) {
        if events.last == event { return }
        if events.count == 64 { events.removeFirst() }
        events.append(event)
    }
    func hasExistingInstance() -> Bool {
        let value = base.hasExistingInstance()
        let entries = NSRunningApplication.runningApplications(withBundleIdentifier: base.bundleIdentifier)
        record("existing=\(value),count=\(entries.count),terminated=\(entries.filter { $0.isTerminated }.count)")
        return value
    }
    func launch(_ completion: @escaping (NSRunningApplication?, Bool) -> Void) {
        record("launch")
        base.launch { app, failed in
            self.record("callback=\(app != nil),failed=\(failed),finished=\(app?.isFinishedLaunching ?? false)")
            completion(app, failed)
        }
    }
    func isExpected(_ app: NSRunningApplication) -> Bool { base.isExpected(app) }
    func isTerminated(_ app: NSRunningApplication) -> Bool { base.isTerminated(app) }
    func instancePresence(_ app: NSRunningApplication) -> MemoryOwnedAppPresence {
        let value = base.instancePresence(app)
        if value != .owned {
            let entries = NSRunningApplication.runningApplications(withBundleIdentifier: base.bundleIdentifier)
            record("presence=\(value),count=\(entries.count),matching=\(entries.contains { $0.isEqual(app) }),terminated=\(app.isTerminated)")
        }
        return value
    }
    func mayTerminate(_ app: NSRunningApplication) -> Bool { base.mayTerminate(app) }
    func terminate(_ app: NSRunningApplication) -> Bool {
        let finished = app.isFinishedLaunching
        let value = base.terminate(app)
        record("terminate=\(value),finished=\(finished),terminated=\(app.isTerminated)")
        return value
    }
}

@main
struct OwnedAppTests {
    static func main() {
        var clock: TimeInterval = 0
        func session(_ fixture: OwnedAppFixture) -> MemoryOwnedAppSession<OwnedAppFixture> {
            MemoryOwnedAppSession(environment: fixture, deadline: 10, cleanupTimeout: 1, now: { clock })
        }
        let preCancelled = OwnedAppFixture(); let before = session(preCancelled)
        before.close(.cancelled); before.start()
        precondition(preCancelled.launches == 0 && before.cleanupVerified)
        let observing = OwnedAppFixture(); let observationSession = session(observing)
        observationSession.start(); observing.callback?(1, false)
        let observation = observationSession.ownedHandle(sessionID: UUID())!
        precondition(observation.isCurrent() && observation.canObserve())
        observationSession.close(.cancelled)
        precondition(!observation.isCurrent() && observation.canObserve())
        observing.unique = false; precondition(!observation.canObserve()); observing.unique = true
        clock = 1; precondition(!observation.canObserve()); clock = 0
        observationSession.tick(); observing.exited = true; observationSession.tick()
        precondition(!observation.canObserve() && !observationSession.cleanupVerified && !observation.originalProcessExitObserved())
        let conflict = OwnedAppFixture(); conflict.existing = true
        let blocked = session(conflict); blocked.start()
        precondition(blocked.reason == .conflict && conflict.launches == 0 && blocked.cleanupVerified)

        let late = OwnedAppFixture(); let cancelling = session(late)
        cancelling.start(); cancelling.start(); cancelling.close(.cancelled)
        cancelling.tick(); precondition(late.launches == 1 && late.terminations == 0)
        late.callback?(1, false)
        precondition(cancelling.state == .closing)
        cancelling.tick(); cancelling.tick()
        precondition(late.terminations == 1 && !cancelling.cleanupVerified)
        late.exited = true; cancelling.tick()
        precondition(cancelling.state == .closed && cancelling.cleanupVerified && cancelling.reason == .cancelled)

        for kind in ["unknown-window", "wrong-app", "new-instance", "refused"] {
            let fixture = OwnedAppFixture(); let s = session(fixture)
            s.start(); fixture.callback?(1, false)
            switch kind {
            case "unknown-window": fixture.safe = false
            case "wrong-app": fixture.expected = false
            case "new-instance": fixture.unique = false
            default: fixture.acceptsTermination = false
            }
            s.close(); s.tick()
            precondition(s.state == .closed && !s.cleanupVerified)
            precondition(fixture.terminations == (kind == "refused" ? 1 : 0))
        }
        let noCallback = OwnedAppFixture(); let unresolved = session(noCallback)
        unresolved.start(); unresolved.close(.cancelled); clock = 2; unresolved.tick()
        precondition(unresolved.state == .closed && !unresolved.cleanupVerified)
        noCallback.callback?(1, false); unresolved.tick()
        precondition(noCallback.terminations == 0 && !unresolved.cleanupVerified)
        clock = 0
        let hung = OwnedAppFixture(); let timedOut = session(hung)
        timedOut.start(); hung.callback?(1, false); clock = 10; timedOut.tick()
        precondition(timedOut.state == .closing && hung.terminations == 1)
        clock = 12; timedOut.tick()
        precondition(timedOut.state == .closed && !timedOut.cleanupVerified && hung.terminations == 1)
        clock = 0
        // LaunchServices inventory can lag both the launch callback and exit state.
        let delayed = OwnedAppFixture(); delayed.absent = true
        let delayedSession = session(delayed)
        delayedSession.start(); delayed.callback?(1, false)
        precondition(delayedSession.state == .launching, "Absent inventory must wait for registration")
        delayedSession.tick(); precondition(delayed.terminations == 0)
        delayed.absent = false; delayedSession.tick()
        precondition(delayedSession.state == .acquired)
        delayedSession.close(.cancelled); delayedSession.tick()
        precondition(delayed.terminations == 1)
        delayed.absent = true; delayedSession.tick(); delayedSession.tick()
        precondition(delayedSession.state == .closing && !delayedSession.cleanupVerified && delayed.terminations == 1)
        delayed.exited = true; delayedSession.tick()
        precondition(delayedSession.cleanupVerified && delayedSession.reason == .cancelled)

        let pendingCancel = OwnedAppFixture(); pendingCancel.absent = true
        let waitingCancel = session(pendingCancel)
        waitingCancel.start(); waitingCancel.close(.cancelled); pendingCancel.callback?(1, false)
        waitingCancel.tick()
        precondition(waitingCancel.state == .closing && pendingCancel.terminations == 0)
        pendingCancel.absent = false; waitingCancel.tick()
        precondition(waitingCancel.state == .closing && pendingCancel.terminations == 1)
        pendingCancel.exited = true; waitingCancel.tick()
        precondition(waitingCancel.cleanupVerified && waitingCancel.reason == .cancelled)

        for afterRequest in [false, true] {
            let missing = OwnedAppFixture(); let bounded = session(missing)
            bounded.start(); missing.callback?(1, false)
            bounded.close(.cancelled)
            if afterRequest { bounded.tick() }
            missing.absent = true; bounded.tick()
            precondition(bounded.state == .closing && !bounded.cleanupVerified)
            clock = 2; bounded.tick()
            precondition(bounded.state == .closed && !bounded.cleanupVerified &&
                bounded.reason == .cleanupUnverified && missing.terminations == (afterRequest ? 1 : 0))
            clock = 0
        }
        let unregistered = OwnedAppFixture(); unregistered.absent = true
        let registrationTimeout = session(unregistered)
        registrationTimeout.start(); unregistered.callback?(1, false)
        clock = 10; registrationTimeout.tick()
        precondition(registrationTimeout.state == .closing)
        clock = 12; registrationTimeout.tick()
        precondition(!registrationTimeout.cleanupVerified && registrationTimeout.state == .closed && unregistered.terminations == 0)
        clock = 0
        for afterRequest in [false, true] {
            let replaced = OwnedAppFixture(); let guarded = session(replaced)
            guarded.start(); replaced.callback?(1, false)
            if afterRequest { guarded.close(); guarded.tick() }
            replaced.unique = false; guarded.tick()
            precondition(guarded.reason == .conflict && !guarded.cleanupVerified &&
                replaced.terminations == (afterRequest ? 1 : 0))
        }
        let lost = OwnedAppFixture(); let acquiredLost = session(lost)
        acquiredLost.start(); lost.callback?(1, false); lost.absent = true; acquiredLost.tick()
        precondition(acquiredLost.reason == .conflict && !acquiredLost.cleanupVerified && lost.terminations == 0)

        let failed = OwnedAppFixture(); let noApp = session(failed)
        noApp.start(); failed.callback?(nil, true)
        precondition(noApp.cleanupVerified && noApp.reason == .launchFailed)

        if CommandLine.arguments.count == 6, CommandLine.arguments[3] == "--lifetime" {
            let args = CommandLine.arguments
            guard let request = UUID(uuidString: args[4]), request.uuidString.lowercased() == args[4] else { exit(2) }
            let environment = ObservedOwnedAppEnvironment(PublicMemoryOwnedAppEnvironment(
                bundleURL: URL(fileURLWithPath: args[1]).resolvingSymlinksInPath(), bundleIdentifier: args[2],
                safeToTerminate: { _ in true }))
            let session = MemoryOwnedAppSession(environment: environment,
                deadline: ProcessInfo.processInfo.systemUptime + 8)
            let driver = MemoryOwnedAppRunLoopDriver(session: session)
            let lifetime = MemoryParentLifetime { driver.cancel() }
            driver.start(onAcquired: { _ in
                try! Data(args[4].utf8).write(to: URL(fileURLWithPath: args[5]), options: .withoutOverwriting)
            }, onClosed: { reason, verified in
                lifetime.stop()
                if !verified {
                    FileHandle.standardError.write(Data("reason=\(reason.rawValue); \(environment.diagnostic)\n".utf8))
                }
                let result: [String: Any] = ["protocolVersion": 1, "sessionId": args[4],
                    "scope": "owned_app_only", "reason": reason.rawValue, "cleanupVerified": verified]
                let data = try! JSONSerialization.data(withJSONObject: result, options: .sortedKeys)
                print(String(data: data, encoding: .utf8)!)
                exit(verified ? 0 : 1)
            })
            RunLoop.main.run()
            return
        }
        guard CommandLine.arguments.count == 3 else {
            print("{\"policy\":true}"); return
        }
        let url = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
        let identifier = CommandLine.arguments[2]
        let environment = ObservedOwnedAppEnvironment(PublicMemoryOwnedAppEnvironment(bundleURL: url, bundleIdentifier: identifier,
            // Only this disposable prohibited-UI fixture is covered by this proof.
            safeToTerminate: { _ in true }))
        let first = MemoryOwnedAppSession(environment: environment,
            deadline: ProcessInfo.processInfo.systemUptime + 8)
        let driver = MemoryOwnedAppRunLoopDriver(session: first)
        var conflicting = false
        driver.start(onAcquired: { _ in
            let other = MemoryOwnedAppSession(environment: environment,
                deadline: ProcessInfo.processInfo.systemUptime + 2)
            other.start()
            conflicting = other.reason == .conflict && other.cleanupVerified && first.state == .acquired
            precondition(conflicting)
            driver.close()
        }, onClosed: { reason, verified in
            precondition(verified && reason == .completed && conflicting,
                "Normal close: reason=\(reason.rawValue), cleanupVerified=\(verified); \(environment.diagnostic)")
            let cancelledSession = MemoryOwnedAppSession(environment: environment,
                deadline: ProcessInfo.processInfo.systemUptime + 8)
            let cancelledDriver = MemoryOwnedAppRunLoopDriver(session: cancelledSession)
            cancelledDriver.start(onAcquired: { _ in
                preconditionFailure("Cancelled launch must not report acquired")
            }, onClosed: { reason, verified in
                precondition(verified && reason == .cancelled,
                    "Cancelled launch: reason=\(reason.rawValue), cleanupVerified=\(verified); \(environment.diagnostic)")
                precondition(!environment.hasExistingInstance())
                print("{\"policy\":true,\"ownedExit\":true,\"conflictUntouched\":true,\"cancelDuringLaunch\":true,\"cleanupVerified\":true}")
                exit(0)
            })
            cancelledDriver.cancel()
        })
        RunLoop.main.run()
    }
}
