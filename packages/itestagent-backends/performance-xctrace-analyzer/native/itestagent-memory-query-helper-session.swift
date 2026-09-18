import AppKit
import Foundation
import Darwin

// A resource owner must supply both the local prepared query and its closure
// observer. No production provider currently supplies physical generation/closure.
protocol MemoryHelperQueryProvider: AnyObject {
    func prepare(hello: [String: Any]) throws -> [[String: Any]]
    func execute(decision: [String: Any], completed: @escaping (String?) -> Void)
    func cancel()
    var resourcesClosed: Bool { get }
}

final class MemoryOwnedQueryProvider: MemoryHelperQueryProvider {
    private let owner: MemoryOwnedAppHandle<NSRunningApplication>
    private let query: PreparedMemoryIdentityQuery
    private let expectedBundleURL: URL
    private let documentURL: URL
    private let deadline: Double
    private let cancellation: MemoryIPCCancellation
    private let closureObserved: () -> Bool
    private let requestClose: () -> Void
    private let grant: MemoryIPCQueryGrant<NSRunningApplication>
    private var driver: MemoryQueryRunLoopDriver<NSRunningApplication>?
    init(owner: MemoryOwnedAppHandle<NSRunningApplication>, query: PreparedMemoryIdentityQuery,
         expectedBundleURL: URL, documentURL: URL, deadline: Double, cancellation: MemoryIPCCancellation,
         closureObserved: @escaping () -> Bool, requestClose: @escaping () -> Void) {
        self.owner = owner; self.query = query; self.expectedBundleURL = expectedBundleURL
        self.documentURL = documentURL; self.deadline = deadline; self.cancellation = cancellation
        self.closureObserved = closureObserved; self.requestClose = requestClose
        grant = MemoryIPCQueryGrant(owner: owner, query: query, deadline: deadline, cancellation: cancellation)
    }
    func prepare(hello: [String: Any]) throws -> [[String: Any]] { try grant.preparedFrames(hello: hello) }
    func execute(decision: [String: Any], completed: @escaping (String?) -> Void) {
        precondition(Thread.isMainThread)
        do {
            let permission = try grant.consume(decision: decision)
            driver = startOwnedMemoryIPCQuery(owner: owner, expectedBundleURL: expectedBundleURL,
                documentURL: documentURL, query: query, grant: permission, deadline: deadline,
                cancellation: cancellation) { session in
                    completed(try? session.resultLine()); self.requestClose()
                }
        } catch { completed(nil); requestClose() }
    }
    func cancel() { cancellation.cancel(); requestClose() }
    var resourcesClosed: Bool { precondition(Thread.isMainThread); return closureObserved() }
}

// Socket reader/writer has no UI side effects. Main-thread provider callbacks are
// serialized; EOF/signals set the shared latch before main-thread cleanup occurs.
final class MemoryHelperQuerySession: @unchecked Sendable {
    let cancellation: MemoryIPCCancellation
    private let lock = NSLock()
    private var outgoing = [[String: Any]]()
    private var readyToExit = false
    private var failed = false
    private var hello: [String: Any]?
    private var sequence = 0
    private var provider: MemoryHelperQueryProvider?
    private var closeTimer: Timer?
    private var closingStarted = false
    private var started = false
    private var transportLost = false
    private var cancelRequested = false
    private var completionIssued = false
    private let deadline: Double
    private let cleanupTimeout: Double
    private let version: Int
    init(deadline: Double, cancellation: MemoryIPCCancellation = MemoryIPCCancellation(), provider: MemoryHelperQueryProvider? = nil, version: Int = 3, cleanupTimeout: Double = 5) {
        precondition(version == 3 || (version == 4 && provider == nil))
        precondition(cleanupTimeout.isFinite && cleanupTimeout > 0 && cleanupTimeout <= 5)
        self.version = version; self.deadline = deadline; self.cancellation = cancellation
        self.provider = provider; self.cleanupTimeout = cleanupTimeout
    }
    private func cancelProvider() {
        precondition(Thread.isMainThread)
        guard !cancelRequested else { return }; cancelRequested = true
        provider?.cancel()
    }
    private func finish(_ safe: Bool, completed: (Bool) -> Void) {
        precondition(Thread.isMainThread)
        guard !completionIssued else { return }; completionIssued = true
        closeTimer?.invalidate(); closeTimer = nil
        completed(safe)
    }
    private func observeAfterTransportLoss(completed: @escaping (Bool) -> Void) {
        precondition(Thread.isMainThread)
        guard !transportLost else { return }; transportLost = true
        closeTimer?.invalidate(); closeTimer = nil
        // Cancellation stops work, not owner cleanup. No frames can be emitted on
        // the lost transport, and helper exit cannot release the enclosing lease.
        let limit = ProcessInfo.processInfo.systemUptime + cleanupTimeout
        cancelProvider()
        func observe() {
            guard ProcessInfo.processInfo.systemUptime < limit else {
                self.finish(false, completed: completed); return
            }
            let closed = self.provider?.resourcesClosed ?? true
            guard ProcessInfo.processInfo.systemUptime < limit else {
                self.finish(false, completed: completed); return
            }
            if closed { self.finish(true, completed: completed) }
        }
        observe()
        if !completionIssued {
            let timer = Timer(timeInterval: 0.025, repeats: true) { _ in observe() }
            closeTimer = timer; RunLoop.main.add(timer, forMode: .common)
        }
    }
    private func enqueue(_ frame: [String: Any]) { lock.lock(); outgoing.append(frame); lock.unlock() }
    private func emit(_ kind: String, result: String? = nil) {
        guard var frame = hello else { return }
        sequence += 1; frame["kind"] = kind; frame["sequence"] = sequence
        if let result { frame["result"] = result }; enqueue(frame)
    }
    private func closeResources() {
        precondition(Thread.isMainThread)
        guard !closingStarted, !transportLost, !completionIssued else { return }; closingStarted = true
        emit("closing")
        func observe() {
            guard self.provider?.resourcesClosed ?? true else { return }
            self.closeTimer?.invalidate(); self.closeTimer = nil
            self.emit("closed"); self.lock.lock(); self.readyToExit = true; self.lock.unlock()
        }
        observe()
        if !readyToExit {
            let timer = Timer(timeInterval: 0.025, repeats: true) { _ in observe() }
            closeTimer = timer; RunLoop.main.add(timer, forMode: .common)
        }
    }
    private func receive(_ frame: [String: Any]) {
        precondition(Thread.isMainThread)
        guard !transportLost, !completionIssued else { return }
        guard !cancellation.cancelled, ProcessInfo.processInfo.systemUptime < deadline else { cancelProvider(); return }
        do {
            if frame["kind"] as? String == "hello", hello == nil {
                hello = frame; sequence = 1
                if let provider {
                    let responses = try provider.prepare(hello: frame)
                    for response in responses { sequence = (response["sequence"] as? Int) ?? 0; enqueue(response) }
                } else {
                    // No resource owner exists. Explicitly close without prepared,
                    // permission request or fake query result.
                    emit("hello_ack"); closeResources()
                }
            } else if frame["kind"] as? String == "decision", let provider {
                sequence = 4
                provider.execute(decision: frame) { result in
                    guard !self.transportLost, !self.completionIssued, !self.cancellation.cancelled else { return }
                    if let result { self.emit("result", result: result) }
                    self.closeResources()
                }
            } else { throw MemoryIPCError.invalid }
        } catch { lock.lock(); failed = true; lock.unlock(); cancellation.cancel(); cancelProvider() }
    }
    func start(path: String, launcherPID: pid_t, completed: @escaping (Bool) -> Void) {
        precondition(Thread.isMainThread)
        guard !started else { return }; started = true
        DispatchQueue(label: "itestagent.query.helper").async {
            var fd: Int32 = -1
            do {
                fd = try memoryIPCConnect(path: path, launcherPID: launcherPID)
                let order = MemoryIPCOrder(deadline: self.deadline, version: self.version); let decoder = MemoryIPCDecoder(version: self.version)
                while !self.cancellation.cancelled {
                    try order.check()
                    self.lock.lock(); let frames = self.outgoing; self.outgoing.removeAll()
                    let done = self.readyToExit; let failed = self.failed; self.lock.unlock()
                    if failed { throw MemoryIPCError.invalid }
                    for frame in frames {
                        try order.accept(frame, parent: false)
                        try memoryIPCWrite(MemoryIPCDecoder.encode(frame, version: self.version), fd: fd, cancellation: self.cancellation, deadline: self.deadline, controlFD: fd)
                    }
                    if done && order.state == "closed" {
                        Darwin.close(fd); fd = -1
                        DispatchQueue.main.async { self.finish(true, completed: completed) }; return
                    }
                    var pending = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
                    if poll(&pending, 1, 20) <= 0 { continue }
                    guard let bytes = try memoryIPCRead(fd) else { throw MemoryIPCError.disconnected }
                    for frame in try decoder.push(bytes) {
                        try order.accept(frame, parent: true)
                        DispatchQueue.main.async { self.receive(frame) }
                    }
                }
            } catch { self.cancellation.cancel() }
            if fd >= 0 { Darwin.close(fd) }
            DispatchQueue.main.async {
                self.observeAfterTransportLoss(completed: completed)
            }
        }
    }
}
