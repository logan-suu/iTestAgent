import ApplicationServices
import Foundation

protocol MemoryConsoleSubmissionAdapter {
    func setTimeout(_ seconds: Float) throws
    func characterCount() throws -> Int
    func text(in range: CFRange) throws -> String
    func selection() throws -> CFRange
    func selectedTextIsSettable() throws -> Bool
    func actions() throws -> [String]
    func insertSelectedText(_ command: String) throws
    func confirm() throws
}

enum MemoryConsoleSubmissionFailure: String, Error {
    case consumed = "submission_already_consumed"
    case cancelled
    case deadline = "deadline_exceeded"
    case contextChanged = "context_changed"
    case inputChanged = "console_input_changed"
    case unsupported = "console_submission_unsupported"
    case queryFailed = "console_query_failed"
    case insertionFailed = "console_insertion_failed"
    case confirmationFailed = "console_confirmation_failed"
}

// One attempt only, including failed prerequisites. Attempt flags are set before
// mutations because an AX error/timeout does not prove the operation had no effect.
final class MemoryConsoleSubmission<A: MemoryConsoleSubmissionAdapter> {
    private let adapter: A
    private let query: PreparedMemoryIdentityQuery
    private let deadline: TimeInterval
    private let now: () -> TimeInterval
    private let cancelled: () -> Bool
    private let contextIsCurrent: () -> Bool
    private var consumed = false
    private(set) var insertionAttempted = false
    private(set) var confirmationAttempted = false
    private let prompt = "(lldb) "

    init(adapter: A, query: PreparedMemoryIdentityQuery, deadline: TimeInterval,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         cancelled: @escaping () -> Bool, contextIsCurrent: @escaping () -> Bool) {
        self.adapter = adapter
        self.query = query
        self.deadline = deadline
        self.now = now
        self.cancelled = cancelled
        self.contextIsCurrent = contextIsCurrent
    }

    private func check() throws {
        if cancelled() { throw MemoryConsoleSubmissionFailure.cancelled }
        guard deadline.isFinite, now() < deadline else { throw MemoryConsoleSubmissionFailure.deadline }
        let current = contextIsCurrent()
        if cancelled() { throw MemoryConsoleSubmissionFailure.cancelled }
        guard now() < deadline else { throw MemoryConsoleSubmissionFailure.deadline }
        guard current else { throw MemoryConsoleSubmissionFailure.contextChanged }
    }

    private func read<T>(_ work: () throws -> T) throws -> T {
        try check()
        try adapter.setTimeout(Float(min(0.5, max(0.001, deadline - now()))))
        try check()
        let result = try work()
        try check()
        return result
    }

    private func verifyInput(_ expected: String) throws {
        let length = expected.utf16.count
        guard try read({ try adapter.characterCount() }) == length,
              try read({ try adapter.text(in: CFRange(location: 0, length: length)) }) == expected else {
            throw MemoryConsoleSubmissionFailure.inputChanged
        }
        let selection = try read { try adapter.selection() }
        guard selection.location == length, selection.length == 0,
              try read({ try adapter.characterCount() }) == length else {
            throw MemoryConsoleSubmissionFailure.inputChanged
        }
    }

    private func verifyCapabilities(requiresAXConfirm: Bool) throws {
        guard try read({ try adapter.selectedTextIsSettable() }) else {
            throw MemoryConsoleSubmissionFailure.unsupported
        }
        guard requiresAXConfirm else { return }
        let actions = try read { try adapter.actions() }
        guard actions.count <= 64, Set(actions).count == actions.count,
              actions.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 }),
              actions.contains(kAXConfirmAction) else { throw MemoryConsoleSubmissionFailure.unsupported }
    }

    // Shared insertion only; strategy selection is explicit before any mutation.
    func insertOnce(requiresAXConfirm: Bool) throws {
        guard !consumed else { throw MemoryConsoleSubmissionFailure.consumed }
        consumed = true
        try check()
        try query.validateSource()
        try verifyCapabilities(requiresAXConfirm: requiresAXConfirm)
        try verifyInput(prompt)
        try query.validateSource()
        try check()
        try read {
            insertionAttempted = true
            try adapter.insertSelectedText(query.command)
        }
        try verifyCapabilities(requiresAXConfirm: requiresAXConfirm)
        try verifyInput(prompt + query.command)
        try query.validateSource()
        try check()
    }

    // Shared post-insertion guard for the explicit experimental Return strategy.
    func verifyInsertedInput() throws {
        try verifyCapabilities(requiresAXConfirm: false)
        try verifyInput(prompt + query.command)
        try query.validateSource()
        try check()
    }

    // AX success is not query execution; a separate response must be validated.
    func submitOnce() throws {
        try insertOnce(requiresAXConfirm: true)
        try read {
            confirmationAttempted = true
            try adapter.confirm()
        }
        // Do not clear input or resubmit when the result is absent or ambiguous.
    }
}

struct PublicMemoryConsoleSubmissionAdapter: MemoryConsoleSubmissionAdapter {
    let element: AXUIElement
    func setTimeout(_ seconds: Float) throws {
        guard AXUIElementSetMessagingTimeout(element, seconds) == .success else {
            throw MemoryConsoleSubmissionFailure.queryFailed
        }
    }
    func characterCount() throws -> Int {
        try PublicMemoryConsoleResponseReader(element: element).characterCount()
    }
    func text(in range: CFRange) throws -> String {
        try PublicMemoryConsoleResponseReader(element: element).text(in: range)
    }
    func selection() throws -> CFRange {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXValueGetTypeID() else {
            throw MemoryConsoleSubmissionFailure.queryFailed
        }
        let boxed = value as! AXValue
        var range = CFRange()
        guard AXValueGetType(boxed) == .cfRange, AXValueGetValue(boxed, .cfRange, &range),
              range.location >= 0, range.length >= 0 else { throw MemoryConsoleSubmissionFailure.queryFailed }
        return range
    }
    func selectedTextIsSettable() throws -> Bool {
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success else {
            throw MemoryConsoleSubmissionFailure.queryFailed
        }
        return settable.boolValue
    }
    func actions() throws -> [String] {
        try PublicMemoryAXCapabilityReader(element: element).actions()
    }
    func insertSelectedText(_ command: String) throws {
        guard AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, command as CFString) == .success else {
            throw MemoryConsoleSubmissionFailure.insertionFailed
        }
    }
    func confirm() throws {
        guard AXUIElementPerformAction(element, kAXConfirmAction as CFString) == .success else {
            throw MemoryConsoleSubmissionFailure.confirmationFailed
        }
    }
}

// The response boundary is captured before insertion. A failed attempt cannot be
// resumed or polled as a successful query, even if an AX call may have had an effect.
final class MemoryConsoleQueryExchange<A: MemoryConsoleSubmissionAdapter, R: MemoryConsoleResponseReader> {
    private enum State { case prepared, awaitingResponse, closed }
    private var state = State.prepared
    private let submission: MemoryConsoleSubmission<A>
    private let receiver: MemoryConsoleResponseReceiver<R>
    var insertionAttempted: Bool { submission.insertionAttempted }
    var confirmationAttempted: Bool { submission.confirmationAttempted }

    init(adapter: A, output: R, query: PreparedMemoryIdentityQuery, deadline: TimeInterval,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         cancelled: @escaping () -> Bool, contextIsCurrent: @escaping () -> Bool) throws {
        receiver = try MemoryConsoleResponseReceiver(reader: output, query: query, deadline: deadline,
            now: now, cancelled: cancelled, contextIsCurrent: contextIsCurrent)
        submission = MemoryConsoleSubmission(adapter: adapter, query: query, deadline: deadline,
            now: now, cancelled: cancelled, contextIsCurrent: contextIsCurrent)
    }

    func submitOnce() throws {
        guard state == .prepared else { throw MemoryConsoleSubmissionFailure.consumed }
        state = .closed
        try submission.submitOnce()
        state = .awaitingResponse
    }

    func poll() throws -> MemoryIdentityResponseCandidate? {
        guard state == .awaitingResponse else { throw MemoryConsoleSubmissionFailure.consumed }
        do {
            let candidate = try receiver.poll()
            if candidate != nil { state = .closed }
            return candidate
        } catch {
            state = .closed
            throw error
        }
    }
}

func prepareLocatedMemoryQueryExchange(
    reader: PublicMemoryAXContextReader, documentURL: URL,
    query: PreparedMemoryIdentityQuery, deadline: TimeInterval,
    now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    cancelled: @escaping () -> Bool
) throws -> MemoryConsoleQueryExchange<PublicMemoryConsoleSubmissionAdapter, PublicMemoryConsoleResponseReader> {
    let pair = try locateMemoryAXConsolePair(reader: reader, documentURL: documentURL,
                                             deadline: deadline, now: now, cancelled: cancelled)
    return try MemoryConsoleQueryExchange(
        adapter: PublicMemoryConsoleSubmissionAdapter(element: pair.context.focusedTextArea),
        output: PublicMemoryConsoleResponseReader(element: pair.output), query: query,
        deadline: deadline, now: now, cancelled: cancelled, contextIsCurrent: {
            (try? locateMemoryAXConsolePair(reader: reader, documentURL: documentURL,
                                            deadline: deadline, now: now, cancelled: cancelled)) == pair
        })
}
