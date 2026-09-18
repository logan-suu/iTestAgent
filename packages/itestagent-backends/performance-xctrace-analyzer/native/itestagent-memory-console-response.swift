import ApplicationServices
import Foundation

protocol MemoryConsoleResponseReader {
    func setTimeout(_ seconds: Float) throws
    func characterCount() throws -> Int
    func text(in range: CFRange) throws -> String
}

enum MemoryConsoleResponseFailure: String, Error {
    case queryFailed = "console_read_failed"
    case changed = "console_changed"
    case limit = "console_response_limit"
    case ambiguous = "console_response_ambiguous"
    case invalidResponse = "console_response_invalid"
    case contextChanged = "context_changed"
    case cancelled
    case deadline = "deadline_exceeded"
    case closed = "console_receiver_closed"
}

// Candidate bytes stay in local IPC only. The existing strict identity parser must
// validate them before any identity event is published. Never log console text.
struct MemoryIdentityResponseCandidate {
    let line: String
}

// Create before the one permitted submission; poll afterward from the owner's run loop.
// This object neither submits nor retries commands. Every failure closes the receiver.
final class MemoryConsoleResponseReceiver<R: MemoryConsoleResponseReader> {
    private let reader: R
    private let query: PreparedMemoryIdentityQuery
    private let deadline: TimeInterval
    private let now: () -> TimeInterval
    private let cancelled: () -> Bool
    private let contextIsCurrent: () -> Bool
    private var cursor = 0
    private var buffer = ""
    private var closed = false
    private var discardFirstLine = false
    private let prefix = "ITESTAGENT_MEMORY_IDENTITY "

    init(reader: R, query: PreparedMemoryIdentityQuery, deadline: TimeInterval,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         cancelled: @escaping () -> Bool, contextIsCurrent: @escaping () -> Bool) throws {
        self.reader = reader
        self.query = query
        self.deadline = deadline
        self.now = now
        self.cancelled = cancelled
        self.contextIsCurrent = contextIsCurrent
        try check()
        try query.validateSource()
        cursor = try read { try reader.characterCount() }
        guard cursor >= 0 else { throw MemoryConsoleResponseFailure.queryFailed }
        if cursor > 0 {
            let tail = try read { try reader.text(in: CFRange(location: cursor - 1, length: 1)) }
            guard tail.utf16.count == 1 else { throw MemoryConsoleResponseFailure.changed }
            discardFirstLine = tail != "\n"
            guard try read({ try reader.characterCount() }) == cursor else {
                throw MemoryConsoleResponseFailure.changed
            }
        }
    }

    private func check() throws {
        if cancelled() { throw MemoryConsoleResponseFailure.cancelled }
        guard deadline.isFinite, now() < deadline else { throw MemoryConsoleResponseFailure.deadline }
        let current = contextIsCurrent()
        // Re-resolution may consume time or observe cancellation before returning false.
        if cancelled() { throw MemoryConsoleResponseFailure.cancelled }
        guard now() < deadline else { throw MemoryConsoleResponseFailure.deadline }
        guard current else { throw MemoryConsoleResponseFailure.contextChanged }
    }

    private func read<T>(_ work: () throws -> T) throws -> T {
        try check()
        try reader.setTimeout(Float(min(0.5, max(0.001, deadline - now()))))
        try check()
        let result = try work()
        try check()
        return result
    }

    func poll() throws -> MemoryIdentityResponseCandidate? {
        guard !closed else { throw MemoryConsoleResponseFailure.closed }
        do {
            try check()
            try query.validateSource()
            let count = try read { try reader.characterCount() }
            guard count >= cursor else { throw MemoryConsoleResponseFailure.changed }
            // Bound both the native range request and the retained total transcript.
            guard count - cursor <= 16384, buffer.utf16.count + count - cursor <= 16384 else {
                throw MemoryConsoleResponseFailure.limit
            }
            if count == cursor { return nil }
            let chunk = try read { try reader.text(in: CFRange(location: cursor, length: count - cursor)) }
            guard chunk.utf16.count == count - cursor else { throw MemoryConsoleResponseFailure.changed }
            let after = try read { try reader.characterCount() }
            guard after >= count else { throw MemoryConsoleResponseFailure.changed }
            buffer += chunk
            cursor = count
            guard buffer.utf8.count <= 32768 else { throw MemoryConsoleResponseFailure.limit }
            // Do not consume a partially written line or an incomplete snapshot.
            guard after == count, buffer.utf8.last == 10 else { return nil }
            var matches: [String] = []
            // NSString splits UTF-16 line feeds even when Swift treats CRLF as one Character.
            let lines = (buffer as NSString).components(separatedBy: "\n")
            for raw in lines.dropFirst(discardFirstLine ? 1 : 0) {
                let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : String(raw)
                guard line.hasPrefix(prefix) else { continue }
                guard line.utf8.count <= 8192,
                      let data = String(line.dropFirst(prefix.count)).data(using: .utf8),
                      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let request = payload["requestId"] as? String else {
                    throw MemoryConsoleResponseFailure.invalidResponse
                }
                if request == query.requestID { matches.append(line) }
            }
            guard matches.count <= 1 else { throw MemoryConsoleResponseFailure.ambiguous }
            guard let line = matches.first else { return nil }
            try query.validateSource()
            try check()
            closed = true
            buffer = ""
            return MemoryIdentityResponseCandidate(line: line)
        } catch {
            closed = true
            buffer = ""
            throw error
        }
    }
}

// A resolved output element only; this adapter does not discover/adopt windows,
// read the entire AXValue, request trust, mutate an element or send keyboard events.
struct PublicMemoryConsoleResponseReader: MemoryConsoleResponseReader {
    let element: AXUIElement

    func setTimeout(_ seconds: Float) throws {
        guard AXUIElementSetMessagingTimeout(element, seconds) == .success else {
            throw MemoryConsoleResponseFailure.queryFailed
        }
    }

    func characterCount() throws -> Int {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXNumberOfCharactersAttribute as CFString, &value) == .success,
              let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue >= 0,
              number.doubleValue <= Double(Int32.max),
              number.doubleValue.rounded(.towardZero) == number.doubleValue else {
            throw MemoryConsoleResponseFailure.queryFailed
        }
        return number.intValue
    }

    func text(in range: CFRange) throws -> String {
        guard range.location >= 0, range.length >= 0, range.length <= 16384,
              range.location <= Int(Int32.max) - range.length else { throw MemoryConsoleResponseFailure.limit }
        var copy = range
        guard let parameter = AXValueCreate(.cfRange, &copy) else { throw MemoryConsoleResponseFailure.queryFailed }
        var value: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(element, kAXStringForRangeParameterizedAttribute as CFString,
                                                        parameter, &value) == .success,
              let value, CFGetTypeID(value) == CFStringGetTypeID() else {
            throw MemoryConsoleResponseFailure.queryFailed
        }
        let string = value as! CFString
        guard CFStringGetLength(string) <= 16384 else { throw MemoryConsoleResponseFailure.limit }
        return string as String
    }
}
