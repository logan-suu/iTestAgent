import Foundation
import Darwin

// No App or device resources. The real session must wait for asynchronous closure
// even when its socket cannot connect and its cancellation latch is already set.
final class DelayedClosureProvider: MemoryHelperQueryProvider {
    let delay: Double
    var cancelledAt: Double?
    var cancellations = 0
    var observations = 0
    init(delay: Double) { self.delay = delay }
    func prepare(hello: [String: Any]) throws -> [[String: Any]] { fatalError("unexpected prepare") }
    func execute(decision: [String: Any], completed: @escaping (String?) -> Void) { fatalError("unexpected execution") }
    func cancel() {
        precondition(Thread.isMainThread)
        cancellations += 1
        if cancelledAt == nil { cancelledAt = ProcessInfo.processInfo.systemUptime }
    }
    var resourcesClosed: Bool {
        precondition(Thread.isMainThread)
        observations += 1
        guard let cancelledAt else { return false }
        return ProcessInfo.processInfo.systemUptime >= cancelledAt + delay
    }
}

@main struct HelperClosureFixture {
    static func main() {
        alarm(5)
        let mode = CommandLine.arguments[1]
        let provider = DelayedClosureProvider(delay: mode == "delayed" ? 0.08 : mode == "never" ? 10 : 0)
        let cancellation = MemoryIPCCancellation()
        if mode == "pre-cancelled" { cancellation.cancel() }
        let session = MemoryHelperQuerySession(
            deadline: ProcessInfo.processInfo.systemUptime + 1, cancellation: cancellation,
            provider: provider, cleanupTimeout: 0.2)
        var result: Bool?
        var callbacks = 0
        session.start(path: "/private/tmp/itestagent-nonexistent-\(UUID().uuidString)/socket", launcherPID: getpid()) {
            result = $0; callbacks += 1
        }
        session.start(path: "/invalid", launcherPID: getpid()) { _ in callbacks += 100 }
        let end = ProcessInfo.processInfo.systemUptime + 2
        while result == nil && ProcessInfo.processInfo.systemUptime < end {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01))
        }
        let observations = provider.observations
        let after = ProcessInfo.processInfo.systemUptime + 0.08
        while ProcessInfo.processInfo.systemUptime < after {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01))
        }
        let output: [String: Any] = ["safeToExit": result ?? false,
            "callbacks": callbacks, "cancellations": provider.cancellations,
            "observations": provider.observations, "timerStopped": observations == provider.observations]
        print(String(decoding: try! JSONSerialization.data(withJSONObject: output), as: UTF8.self))
        withExtendedLifetime(session) {}
    }
}
