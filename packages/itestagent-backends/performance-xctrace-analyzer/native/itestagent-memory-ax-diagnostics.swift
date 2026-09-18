import Foundation

// Closed vocabularies prevent exception descriptions, attributes and UI values
// from being accidentally copied into diagnostic output.
enum MemoryAXProbeStage: String, Codable, CaseIterable {
    case windows, windowIdentity, document, tree, pair, focus
    case writable, actions, inputCount, prompt, selection, outputCount, outputRange
    case finalWindows, finalDocument, finalFocus, complete
}
enum MemoryAXProbeOperation: String, Codable, CaseIterable {
    case context, timeout, attribute, childCount, children, validation, budget
    case settable, actionNames, characterCount, stringRange, selectedRange
    case role, identifier, description, document, focusedElement
}
enum MemoryAXProbeCause: String, Codable {
    case axError, invalidType, missingValue, limit, mismatch, ambiguous, cycle
    case contextChanged, deadline, cancelled, unexpected
}
struct MemoryAXProbeFailure: Error, Encodable {
    let stage: MemoryAXProbeStage
    let operation: MemoryAXProbeOperation
    let cause: MemoryAXProbeCause
    let axCode: Int32?
    let nodesVisited: Int
    let depth: Int
    let elapsedMilliseconds: Int
}

// One terminal failure per observation. Recording diagnostics never retries an
// operation or returns success. Raw errors and values are deliberately not accepted.
final class MemoryAXProbeDiagnostics {
    private let now: () -> TimeInterval
    private let started: TimeInterval
    private(set) var failure: MemoryAXProbeFailure?
    private var stage = MemoryAXProbeStage.windows
    private var operation = MemoryAXProbeOperation.context
    private var nodes = 0
    private var depth = 0

    init(now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.now = now
        self.started = now()
    }
    func mark(_ stage: MemoryAXProbeStage, _ operation: MemoryAXProbeOperation = .validation) throws {
        if let failure = failure { throw failure }
        self.stage = stage
        self.operation = operation
    }
    func operation(_ operation: MemoryAXProbeOperation) throws {
        if let failure = failure { throw failure }
        self.operation = operation
    }
    func progress(nodes: Int, depth: Int) {
        guard failure == nil else { return }
        self.nodes = min(513, max(0, nodes))
        self.depth = min(17, max(0, depth))
    }
    func fail(_ cause: MemoryAXProbeCause, axCode: Int32? = nil) -> MemoryAXProbeFailure {
        if let failure = failure { return failure }
        let elapsed = now() - started
        let milliseconds = elapsed.isFinite ? Int(min(60000, max(0, elapsed * 1000))) : 0
        // Values come from the public AXError.h enum, never arbitrary OS messages.
        let code = axCode.flatMap { (-25214 ... -25200).contains($0) ? $0 : nil }
        let value = MemoryAXProbeFailure(stage: stage, operation: operation, cause: cause,
            axCode: cause == .axError ? code : nil, nodesVisited: nodes,
            depth: depth, elapsedMilliseconds: milliseconds)
        failure = value
        return value
    }
    func require(_ condition: Bool, _ cause: MemoryAXProbeCause) throws {
        if let failure = failure { throw failure }
        if !condition { throw fail(cause) }
    }
    func ax(_ code: Int32) throws {
        if let failure = failure { throw failure }
        if code != 0 { throw fail(.axError, axCode: code) }
    }
}
