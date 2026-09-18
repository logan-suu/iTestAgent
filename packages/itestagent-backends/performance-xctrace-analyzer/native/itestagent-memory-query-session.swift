import AppKit
import Foundation
import CryptoKit

struct MemoryQueryBinding: Equatable {
    let sessionID: UUID
    let requestID: String
    let strategy: String
    let commandSHA256: String
    init<Application>(owner: MemoryOwnedAppHandle<Application>, query: PreparedMemoryIdentityQuery) {
        sessionID = owner.sessionID
        requestID = query.requestID
        strategy = "pidReturn"
        commandSHA256 = SHA256.hash(data: Data(query.command.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

enum MemoryQuerySessionFailure: Error { case authorization, cancelled, deadline, ownerChanged, consumed }

// Internal in-memory grant. Only the upper-layer PermissionEngine decision may
// authorize production use; this object is not an IPC credential or persistent allow.
final class MemoryQueryGrant<Application> {
    private let binding: MemoryQueryBinding
    private let owner: MemoryOwnedAppHandle<Application>
    private let allowed: Bool
    private let deadline: TimeInterval
    private let now: () -> TimeInterval
    private var consumed = false
    init(owner: MemoryOwnedAppHandle<Application>, query: PreparedMemoryIdentityQuery,
         deadline: TimeInterval, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         decision: (MemoryQueryBinding) -> Bool) {
        precondition(Thread.isMainThread)
        self.owner = owner; self.deadline = deadline; self.now = now
        binding = MemoryQueryBinding(owner: owner, query: query)
        allowed = deadline.isFinite && now() < deadline && owner.isCurrent() && decision(binding)
    }
    fileprivate func consume(owner: MemoryOwnedAppHandle<Application>, binding: MemoryQueryBinding) throws {
        precondition(Thread.isMainThread)
        guard !consumed else { throw MemoryQuerySessionFailure.consumed }
        consumed = true
        guard allowed, now() < deadline, self.owner === owner, self.binding == binding, owner.isCurrent() else {
            throw MemoryQuerySessionFailure.authorization
        }
    }
}

protocol MemoryQueryExchange: AnyObject {
    var insertionAttempted: Bool { get }
    var downAttempted: Bool { get }
    var upAttempted: Bool { get }
    func submitOnce() throws
    func poll() throws -> MemoryIdentityResponseCandidate?
}
extension MemoryConsoleReturnExchange: MemoryQueryExchange {}

// A query result only. Neither this session nor its timer releases the capture
// lease or reports debugger/AUT/document cleanup. The enclosing owner must do that.
final class MemoryQuerySession<Application> {
    enum State { case waitingAuthorization, preparing, awaitingCandidate, terminal }
    private(set) var state = State.waitingAuthorization
    let binding: MemoryQueryBinding
    private let owner: MemoryOwnedAppHandle<Application>
    private let query: PreparedMemoryIdentityQuery
    private let grant: MemoryQueryGrant<Application>
    private let deadline: TimeInterval
    private let now: () -> TimeInterval
    private let cancelled: () -> Bool
    private var exchange: (any MemoryQueryExchange)?
    private(set) var candidate: MemoryIdentityResponseCandidate?
    private(set) var reason = "not_started"
    var insertionAttempted: Bool { exchange?.insertionAttempted ?? false }
    var downAttempted: Bool { exchange?.downAttempted ?? false }
    var upAttempted: Bool { exchange?.upAttempted ?? false }

    init(owner: MemoryOwnedAppHandle<Application>, query: PreparedMemoryIdentityQuery,
         grant: MemoryQueryGrant<Application>, deadline: TimeInterval,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         cancelled: @escaping () -> Bool) {
        self.owner = owner; self.query = query; self.grant = grant
        self.deadline = deadline; self.now = now; self.cancelled = cancelled
        binding = MemoryQueryBinding(owner: owner, query: query)
    }
    private func check() throws {
        if cancelled() { throw MemoryQuerySessionFailure.cancelled }
        guard deadline.isFinite, now() < deadline else { throw MemoryQuerySessionFailure.deadline }
        guard owner.isCurrent() else { throw MemoryQuerySessionFailure.ownerChanged }
        try query.validateSource()
        if cancelled() { throw MemoryQuerySessionFailure.cancelled }
        guard now() < deadline else { throw MemoryQuerySessionFailure.deadline }
    }
    private func fail(_ error: Error) {
        candidate = nil
        reason = cancelled() ? "cancelled" : "query_failed"
        state = .terminal
    }
    // The factory captures its output baseline only after this grant is consumed.
    func start(makeExchange: () throws -> any MemoryQueryExchange) {
        precondition(Thread.isMainThread)
        guard state == .waitingAuthorization else { return }
        state = .preparing
        do {
            try grant.consume(owner: owner, binding: binding)
            try check()
            let prepared = try makeExchange()
            exchange = prepared
            try check()
            try prepared.submitOnce()
            try check()
            state = .awaitingCandidate
        } catch { fail(error) }
    }
    func tick() {
        precondition(Thread.isMainThread)
        guard state == .awaitingCandidate, let exchange else { return }
        do {
            try check()
            let value = try exchange.poll()
            try check()
            if let value { candidate = value; reason = "candidate"; state = .terminal }
        } catch { fail(error) }
    }
    func resultLine() throws -> String {
        guard state == .terminal else { throw MemoryQuerySessionFailure.consumed }
        var value: [String: Any] = ["protocolVersion": 1,
            "sessionId": binding.sessionID.uuidString.lowercased(), "requestId": binding.requestID,
            "strategy": binding.strategy, "commandSHA256": binding.commandSHA256,
            "status": reason == "candidate" ? "candidate" : (reason == "cancelled" ? "cancelled" : "failed"),
            "insertionAttempted": insertionAttempted, "downAttempted": downAttempted, "upAttempted": upAttempted]
        if let candidate { value["candidateLine"] = candidate.line }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
}

final class MemoryQueryRunLoopDriver<Application> {
    private let session: MemoryQuerySession<Application>
    private var started = false
    private var timer: Timer?
    init(session: MemoryQuerySession<Application>) { self.session = session }
    func start(makeExchange: () throws -> any MemoryQueryExchange,
               onTerminal: @escaping (MemoryQuerySession<Application>) -> Void) {
        precondition(Thread.isMainThread)
        guard !started else { return }; started = true
        session.start(makeExchange: makeExchange)
        if session.state == .terminal { onTerminal(session); return }
        let timer = Timer(timeInterval: 0.025, repeats: true) { _ in
            self.session.tick()
            if self.session.state == .terminal {
                self.timer?.invalidate(); self.timer = nil
                onTerminal(self.session)
            }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }
}

// Explicit internal connection only. It does not launch Xcode, open a project,
// mint an authorization or release the enclosing capture lease.
func startOwnedMemoryReturnQuery(
    owner: MemoryOwnedAppHandle<NSRunningApplication>, expectedBundleURL: URL, documentURL: URL,
    query: PreparedMemoryIdentityQuery, grant: MemoryQueryGrant<NSRunningApplication>,
    deadline: TimeInterval, lifetime: MemoryParentLifetime, cancelled: @escaping () -> Bool,
    onTerminal: @escaping (MemoryQuerySession<NSRunningApplication>) -> Void
) -> MemoryQueryRunLoopDriver<NSRunningApplication> {
    let isCancelled = { lifetime.isCancelled || cancelled() }
    let session = MemoryQuerySession(owner: owner, query: query, grant: grant,
                                    deadline: deadline, cancelled: isCancelled)
    let driver = MemoryQueryRunLoopDriver(session: session)
    driver.start(makeExchange: {
        guard owner.isCurrent() else { throw MemoryQuerySessionFailure.ownerChanged }
        let reader = PublicMemoryAXContextReader(launchedApplication: owner.application,
                                                expectedBundleURL: expectedBundleURL)
        return try prepareLocatedMemoryReturnExchange(reader: reader, documentURL: documentURL,
            query: query, deadline: deadline, cancelled: { isCancelled() || !owner.isCurrent() })
    }, onTerminal: onTerminal)
    return driver
}
