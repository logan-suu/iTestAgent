import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Deliberately no arbitrary key, modifiers, target PID or delivery-success result.
protocol MemoryConsoleReturnTransport {
    func permissionsAvailable() -> Bool
    func originalInstanceIsCurrent() -> Bool
    func postReturnDown() throws
    func postReturnUp() throws
}

enum MemoryConsoleReturnFailure: String, Error {
    case permissionUnavailable = "event_permission_unavailable"
    case originalInstanceChanged = "original_instance_changed"
    case eventUnavailable = "event_unavailable"
}

// Explicit pidReturn experiment. Construction captures the output boundary before
// insertion; AXConfirm remains a separate strategy, with no automatic fallback.
final class MemoryConsoleReturnExchange<A: MemoryConsoleSubmissionAdapter,
                                       R: MemoryConsoleResponseReader,
                                       T: MemoryConsoleReturnTransport> {
    enum State { case prepared, prerequisites, inserting, downAttempted, upAttempted, awaitingResponse, terminal }
    private(set) var state = State.prepared
    private(set) var downAttempted = false
    private(set) var upAttempted = false
    // A void post can never verify delivery, including delivery of the paired up.
    var releaseDeliveryVerified: Bool { false }
    var insertionAttempted: Bool { submission.insertionAttempted }
    private let submission: MemoryConsoleSubmission<A>
    private let receiver: MemoryConsoleResponseReceiver<R>
    private let transport: T
    private let check: () throws -> Void

    init(adapter: A, output: R, transport: T, query: PreparedMemoryIdentityQuery,
         deadline: TimeInterval,
         now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         cancelled: @escaping () -> Bool, contextIsCurrent: @escaping () -> Bool) throws {
        self.transport = transport
        let guardedContext = {
            transport.permissionsAvailable() && transport.originalInstanceIsCurrent() && contextIsCurrent()
        }
        check = {
            if cancelled() { throw MemoryConsoleSubmissionFailure.cancelled }
            guard deadline.isFinite, now() < deadline else { throw MemoryConsoleSubmissionFailure.deadline }
            guard transport.permissionsAvailable() else { throw MemoryConsoleReturnFailure.permissionUnavailable }
            guard transport.originalInstanceIsCurrent() else { throw MemoryConsoleReturnFailure.originalInstanceChanged }
            let current = contextIsCurrent()
            if cancelled() { throw MemoryConsoleSubmissionFailure.cancelled }
            guard now() < deadline else { throw MemoryConsoleSubmissionFailure.deadline }
            guard current else { throw MemoryConsoleSubmissionFailure.contextChanged }
            try query.validateSource()
        }
        receiver = try MemoryConsoleResponseReceiver(reader: output, query: query, deadline: deadline,
            now: now, cancelled: cancelled, contextIsCurrent: guardedContext)
        submission = MemoryConsoleSubmission(adapter: adapter, query: query, deadline: deadline,
            now: now, cancelled: cancelled, contextIsCurrent: guardedContext)
    }

    private func releaseOnce() throws {
        guard downAttempted, !upAttempted else { return }
        // Cleanup ignores cancellation, focus and the semantic deadline. It must
        // never target a replacement process, even if that process reused the PID.
        guard transport.originalInstanceIsCurrent() else { throw MemoryConsoleReturnFailure.originalInstanceChanged }
        upAttempted = true
        state = .upAttempted
        try transport.postReturnUp()
    }

    func submitOnce() throws {
        guard state == .prepared else { throw MemoryConsoleSubmissionFailure.consumed }
        state = .prerequisites
        do {
            try check()
            state = .inserting
            try submission.insertOnce(requiresAXConfirm: false)
            try submission.verifyInsertedInput()
            try check()
            downAttempted = true
            state = .downAttempted
            try transport.postReturnDown()
            try releaseOnce()
            try check()
            state = .awaitingResponse
        } catch {
            // A thrown send may have delivered. At most one paired release is
            // attempted, and the original failure remains authoritative.
            try? releaseOnce()
            state = .terminal
            throw error
        }
    }

    func poll() throws -> MemoryIdentityResponseCandidate? {
        guard state == .awaitingResponse else { throw MemoryConsoleSubmissionFailure.consumed }
        do {
            try check()
            let result = try receiver.poll()
            if result != nil { state = .terminal }
            return result
        } catch {
            state = .terminal
            throw error
        }
    }
}

// Compile-only in ADR-045 stage 1. The caller must supply its own launch callback
// instance under the global lease; this adapter cannot acquire/adopt ownership.
final class PublicMemoryConsoleReturnTransport: MemoryConsoleReturnTransport {
    private let application: NSRunningApplication
    private let bundleURL: URL
    private let pid: pid_t
    private let down: CGEvent
    private let up: CGEvent

    init(launchedApplication: NSRunningApplication, expectedBundleURL: URL) throws {
        application = launchedApplication
        bundleURL = expectedBundleURL.standardizedFileURL
        pid = launchedApplication.processIdentifier
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0x24, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0x24, keyDown: false) else {
            throw MemoryConsoleReturnFailure.eventUnavailable
        }
        down.flags = []
        up.flags = []
        self.down = down
        self.up = up
    }
    func permissionsAvailable() -> Bool { AXIsProcessTrusted() && CGPreflightPostEventAccess() }
    func originalInstanceIsCurrent() -> Bool {
        guard Thread.isMainThread, pid > 0, !application.isTerminated,
              application.processIdentifier == pid, application.bundleIdentifier == "com.apple.dt.Xcode",
              application.bundleURL?.standardizedFileURL == bundleURL else { return false }
        let instances = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dt.Xcode")
        return instances.count == 1 && instances[0].isEqual(application)
    }
    func postReturnDown() throws {
        guard permissionsAvailable(), originalInstanceIsCurrent(), application.isActive else {
            throw MemoryConsoleReturnFailure.originalInstanceChanged
        }
        down.postToPid(pid)
    }
    func postReturnUp() throws {
        guard originalInstanceIsCurrent() else { throw MemoryConsoleReturnFailure.originalInstanceChanged }
        up.postToPid(pid)
    }
}

func prepareLocatedMemoryReturnExchange(
    reader: PublicMemoryAXContextReader, documentURL: URL,
    query: PreparedMemoryIdentityQuery, deadline: TimeInterval,
    now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    cancelled: @escaping () -> Bool
) throws -> MemoryConsoleReturnExchange<PublicMemoryConsoleSubmissionAdapter,
                                       PublicMemoryConsoleResponseReader, PublicMemoryConsoleReturnTransport> {
    // Retain the directory identity for this exchange, not just each traversal.
    let binding = try MemoryLocalDocumentBinding(expectedURL: documentURL)
    let pair = try locateMemoryAXConsolePair(reader: reader, documentURL: documentURL,
        deadline: deadline, now: now, cancelled: cancelled)
    let transport = try PublicMemoryConsoleReturnTransport(launchedApplication: reader.launchedApplication,
                                                          expectedBundleURL: reader.expectedBundleURL)
    return try MemoryConsoleReturnExchange(
        adapter: PublicMemoryConsoleSubmissionAdapter(element: pair.context.focusedTextArea),
        output: PublicMemoryConsoleResponseReader(element: pair.output), transport: transport,
        query: query, deadline: deadline, now: now, cancelled: cancelled, contextIsCurrent: {
            binding.matches(documentURL.absoluteString) &&
            (try? locateMemoryAXConsolePair(reader: reader, documentURL: documentURL,
                deadline: deadline, now: now, cancelled: cancelled)) == pair
        })
}
