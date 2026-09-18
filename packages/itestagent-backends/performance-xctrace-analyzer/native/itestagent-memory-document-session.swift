import AppKit
import ApplicationServices
import Foundation

enum MemoryDocumentOwnerState { case current, exited, unknown }
enum MemoryDocumentObservation: String { case observedOpen = "observed_open", windowUnavailable = "window_unavailable", ownerExited = "owner_exited", unknown }
enum MemoryDocumentSessionError: Error { case unavailable }

protocol MemoryDocumentEnvironment {
    associatedtype Owner: AnyObject
    associatedtype Window: Equatable
    var owner: Owner { get }
    func ownerState(_ original: Owner) -> MemoryDocumentOwnerState
    // Must return a complete, bounded snapshot or throw; never partial success.
    func windows(deadline: Double) throws -> [Window]
    func document(_ window: Window, deadline: Double) throws -> String
}

// Observation only. There is deliberately no cleanupVerified or lease-proof API.
// All operations, including destruction notifications, are serialized on main.
final class MemoryDocumentSession<E: MemoryDocumentEnvironment> {
    fileprivate let environment: E
    fileprivate let original: E.Owner
    private let binding: MemoryLocalDocumentBinding
    private let url: String
    private let deadline: Double
    private let now: () -> Double
    private let cancelled: () -> Bool
    fileprivate var window: E.Window?
    private var unavailable = false
    private var poisoned = false
    private var exited = false

    init(environment: E, documentURL: URL, deadline: Double,
         now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime },
         cancelled: @escaping () -> Bool) throws {
        precondition(Thread.isMainThread)
        self.environment = environment; original = environment.owner
        self.deadline = deadline; self.now = now; self.cancelled = cancelled
        binding = try MemoryLocalDocumentBinding(expectedURL: documentURL)
        url = documentURL.absoluteString
        guard check() == .current else { throw MemoryDocumentSessionError.unavailable }
        let windows = try environment.windows(deadline: deadline)
        guard windows.count == 1, let selected = windows.first, check() == .current else { throw MemoryDocumentSessionError.unavailable }
        let path = try environment.document(selected, deadline: deadline)
        guard check() == .current, binding.matches(path) else { throw MemoryDocumentSessionError.unavailable }
        let confirmed = try environment.windows(deadline: deadline)
        guard confirmed == windows, check() == .current else { throw MemoryDocumentSessionError.unavailable }
        window = selected
    }

    private func check() -> MemoryDocumentOwnerState {
        guard !poisoned, !cancelled(), deadline.isFinite, now() < deadline,
              environment.owner === original, binding.matches(url) else { poisoned = true; return .unknown }
        let state = environment.ownerState(original)
        guard !cancelled(), now() < deadline, environment.owner === original, binding.matches(url), state != .unknown else {
            poisoned = true; return .unknown
        }
        if exited && state != .exited { poisoned = true; return .unknown }
        if state == .exited { exited = true }
        return state
    }

    func windowDestroyed(owner: E.Owner, window: E.Window) {
        precondition(Thread.isMainThread)
        guard owner === original, self.window == window else { return }
        // AX explicitly allows equality comparisons after destruction, not reads.
        unavailable = true
    }

    func observe() -> MemoryDocumentObservation {
        precondition(Thread.isMainThread)
        switch check() {
        case .unknown: return .unknown
        case .exited: return .ownerExited
        case .current: break
        }
        if unavailable { return .windowUnavailable }
        do {
            let windows = try environment.windows(deadline: deadline)
            guard check() == .current else { return observeTerminal() }
            if unavailable { return .windowUnavailable }
            guard let window else { poisoned = true; return .unknown }
            if windows.isEmpty { unavailable = true; return .windowUnavailable }
            guard windows.count == 1, windows.first == window else { poisoned = true; return .unknown }
            let path = try environment.document(window, deadline: deadline)
            guard check() == .current else { return observeTerminal() }
            if unavailable { return .windowUnavailable }
            guard binding.matches(path) else { poisoned = true; return .unknown }
            let confirmed = try environment.windows(deadline: deadline)
            guard check() == .current else { return observeTerminal() }
            if unavailable { return .windowUnavailable }
            guard confirmed == windows else { poisoned = true; return .unknown }
            return .observedOpen
        } catch {
            if check() == .current && unavailable { return .windowUnavailable }
            poisoned = true; return .unknown
        }
    }
    private func observeTerminal() -> MemoryDocumentObservation {
        poisoned ? .unknown : exited ? .ownerExited : .unknown
    }
}

// The handle can only be minted by the existing acquired launch owner. This
// adapter cannot adopt a PID, launch an app, close a window, or grant permission.
final class MemoryDocumentInvalidation { var destroyed = false }

struct PublicMemoryDocumentEnvironment: MemoryDocumentEnvironment {
    let owner: MemoryOwnedAppHandle<NSRunningApplication>
    let expectedBundleURL: URL
    let invalidation = MemoryDocumentInvalidation()
    func ownerState(_ original: MemoryOwnedAppHandle<NSRunningApplication>) -> MemoryDocumentOwnerState {
        precondition(Thread.isMainThread)
        guard original === owner else { return .unknown }
        if original.application.isTerminated { return .exited }
        return original.isCurrent() ? .current : .unknown
    }
    private var reader: PublicMemoryAXContextReader {
        PublicMemoryAXContextReader(launchedApplication: owner.application, expectedBundleURL: expectedBundleURL)
    }
    private func read<T>(_ node: AXUIElement, deadline: Double, _ work: () throws -> T) throws -> T {
        guard !invalidation.destroyed, deadline.isFinite, ProcessInfo.processInfo.systemUptime < deadline,
              reader.ownerIsCurrent() else { throw MemoryDocumentSessionError.unavailable }
        try reader.setTimeout(node, Float(min(0.5, max(0.001, deadline - ProcessInfo.processInfo.systemUptime))))
        let value = try work()
        guard !invalidation.destroyed, ProcessInfo.processInfo.systemUptime < deadline, reader.ownerIsCurrent() else { throw MemoryDocumentSessionError.unavailable }
        return value
    }
    func windows(deadline: Double) throws -> [AXUIElement] {
        let context = reader
        let windows = try read(context.application, deadline: deadline) { try context.windows() }
        guard windows.count <= 1 else { throw MemoryDocumentSessionError.unavailable }
        var pending = windows.map { ($0, 0) }; var visited = [AXUIElement]()
        while let (node, depth) = pending.popLast() {
            guard depth <= 16, visited.count < 512, !visited.contains(node) else { throw MemoryDocumentSessionError.unavailable }
            visited.append(node)
            let role = try read(node, deadline: deadline) { try context.role(node) }
            guard role != kAXSheetRole, role != "AXDialog" else { throw MemoryDocumentSessionError.unavailable }
            if depth == 0 {
                let modal = try read(node, deadline: deadline) { () throws -> Bool in
                    var value: CFTypeRef?
                    guard AXUIElementCopyAttributeValue(node, kAXModalAttribute as CFString, &value) == .success,
                          let value, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw MemoryDocumentSessionError.unavailable }
                    return CFBooleanGetValue((value as! CFBoolean))
                }
                guard !modal else { throw MemoryDocumentSessionError.unavailable }
                let identifier = try read(node, deadline: deadline) { try context.identifier(node) }
                guard role == kAXWindowRole, identifier == "Xcode.WorkspaceWindow" else { throw MemoryDocumentSessionError.unavailable }
            }
            let children = try read(node, deadline: deadline) { try context.children(node) }
            guard pending.count + children.count + visited.count <= 512 else { throw MemoryDocumentSessionError.unavailable }
            pending.append(contentsOf: children.map { ($0, depth + 1) })
        }
        let confirmed = try read(context.application, deadline: deadline) { try context.windows() }
        guard confirmed == windows else { throw MemoryDocumentSessionError.unavailable }
        return windows
    }
    func document(_ window: AXUIElement, deadline: Double) throws -> String {
        try read(window, deadline: deadline) { try reader.document(window) }
    }
}

private final class MemoryDocumentNotificationSink {
    let receive: (AXUIElement) -> Void
    init(_ receive: @escaping (AXUIElement) -> Void) { self.receive = receive }
}

// Retain this watch for the session lifetime. No property read is made on a
// destroyed element, including teardown; removing the run-loop source then
// releasing AXObserver ends observation without using the invalid window again.
final class MemoryDocumentDestructionWatch {
    private let observer: AXObserver
    private let sink: MemoryDocumentNotificationSink
    init(session: MemoryDocumentSession<PublicMemoryDocumentEnvironment>,
         owner: MemoryOwnedAppHandle<NSRunningApplication>) throws {
        precondition(Thread.isMainThread)
        guard session.original === owner, session.observe() == .observedOpen, let window = session.window else { throw MemoryDocumentSessionError.unavailable }
        sink = MemoryDocumentNotificationSink {
            if session.window == $0 { session.environment.invalidation.destroyed = true }
            session.windowDestroyed(owner: owner, window: $0)
        }
        var created: AXObserver?
        let result = AXObserverCreate(owner.application.processIdentifier, { _, element, notification, context in
            guard notification as String == kAXUIElementDestroyedNotification, let context else { return }
            Unmanaged<MemoryDocumentNotificationSink>.fromOpaque(context).takeUnretainedValue().receive(element)
        }, &created)
        guard result == .success, let created else { throw MemoryDocumentSessionError.unavailable }
        observer = created
        guard AXObserverAddNotification(observer, window, kAXUIElementDestroyedNotification as CFString,
            Unmanaged.passUnretained(sink).toOpaque()) == .success else { throw MemoryDocumentSessionError.unavailable }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
    }
    deinit {
        precondition(Thread.isMainThread)
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
    }
}
