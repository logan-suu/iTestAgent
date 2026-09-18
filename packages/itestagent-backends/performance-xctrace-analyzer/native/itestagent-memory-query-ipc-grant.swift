import AppKit
import Foundation

// Main-thread handoff from the helper's sole framed reader. Transport peer credentials
// must already be checked; frames alone never establish launch ownership. The same
// cancellation latch is updated by the worker on EOF/signal before a queued UI action.
final class MemoryIPCQueryGrant<Application> {
    private let owner: MemoryOwnedAppHandle<Application>
    private let query: PreparedMemoryIdentityQuery
    private let binding: MemoryQueryBinding
    private let deadline: TimeInterval
    private let cancellation: MemoryIPCCancellation
    private let order: MemoryIPCOrder
    private var hello: [String: Any]?
    private var consumed = false
    init(owner: MemoryOwnedAppHandle<Application>, query: PreparedMemoryIdentityQuery,
         deadline: TimeInterval, cancellation: MemoryIPCCancellation) {
        self.owner = owner; self.query = query; self.deadline = deadline; self.cancellation = cancellation
        binding = MemoryQueryBinding(owner: owner, query: query)
        order = MemoryIPCOrder(deadline: deadline)
    }
    func preparedFrames(hello: [String: Any]) throws -> [[String: Any]] {
        precondition(Thread.isMainThread)
        do {
            guard !consumed, !cancellation.cancelled, owner.isCurrent(), self.hello == nil,
                  hello["sessionId"] as? String == binding.sessionID.uuidString.lowercased(),
                  hello["requestId"] as? String == binding.requestID,
                  hello["strategy"] as? String == binding.strategy,
                  hello["commandSHA256"] as? String == binding.commandSHA256 else { throw MemoryIPCError.invalid }
            try query.validateSource(); try order.accept(hello, parent: true)
            self.hello = hello
            var ack = hello; ack["kind"] = "hello_ack"; ack["sequence"] = 2
            try order.accept(ack, parent: false)
            var prepared = hello; prepared["kind"] = "prepared"; prepared["sequence"] = 3
            try order.accept(prepared, parent: false)
            return [ack, prepared]
        } catch { consumed = true; throw error }
    }
    func consume(decision: [String: Any]) throws -> MemoryQueryGrant<Application> {
        precondition(Thread.isMainThread)
        guard !consumed else { throw MemoryIPCError.invalid }; consumed = true
        guard hello != nil, !cancellation.cancelled, owner.isCurrent() else { throw MemoryIPCError.cancelled }
        try order.accept(decision, parent: true); try query.validateSource()
        guard decision["effect"] as? String == "allow" else { throw MemoryQuerySessionFailure.authorization }
        return MemoryQueryGrant(owner: owner, query: query, deadline: deadline) { local in
            !self.cancellation.cancelled && local == self.binding && self.owner.isCurrent()
        }
    }
}

// The framed channel owns cancellation. Do not instantiate MemoryParentLifetime
// beside it: that legacy reader interprets control bytes as cancellation.
func startOwnedMemoryIPCQuery(
    owner: MemoryOwnedAppHandle<NSRunningApplication>, expectedBundleURL: URL, documentURL: URL,
    query: PreparedMemoryIdentityQuery, grant: MemoryQueryGrant<NSRunningApplication>,
    deadline: TimeInterval, cancellation: MemoryIPCCancellation,
    onTerminal: @escaping (MemoryQuerySession<NSRunningApplication>) -> Void
) -> MemoryQueryRunLoopDriver<NSRunningApplication> {
    let session = MemoryQuerySession(owner: owner, query: query, grant: grant,
                                    deadline: deadline, cancelled: { cancellation.cancelled })
    let driver = MemoryQueryRunLoopDriver(session: session)
    driver.start(makeExchange: {
        guard owner.isCurrent(), !cancellation.cancelled else { throw MemoryQuerySessionFailure.ownerChanged }
        let reader = PublicMemoryAXContextReader(launchedApplication: owner.application,
                                                expectedBundleURL: expectedBundleURL)
        return try prepareLocatedMemoryReturnExchange(reader: reader, documentURL: documentURL,
            query: query, deadline: deadline, cancelled: { cancellation.cancelled || !owner.isCurrent() })
    }, onTerminal: onTerminal)
    return driver
}
