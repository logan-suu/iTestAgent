import AppKit
import ApplicationServices
import Foundation

protocol MemoryAXContextReader {
    associatedtype Node: Equatable
    var application: Node { get }
    func ownerIsCurrent() -> Bool
    func setTimeout(_ node: Node, _ seconds: Float) throws
    func windows() throws -> [Node]
    func focus() throws -> Node
    func role(_ node: Node) throws -> String
    func identifier(_ node: Node) throws -> String?
    func document(_ node: Node) throws -> String
    func children(_ node: Node) throws -> [Node]
}

enum MemoryAXContextFailure: String, Error {
    case queryFailed = "accessibility_query_failed"
    case changed = "context_changed"
    case ambiguous = "context_ambiguous"
    case unavailable = "console_candidate_unavailable"
    case limit = "context_limit_exceeded"
    case cancelled
    case deadline = "deadline_exceeded"
}

struct MemoryAXConsoleCandidate<Node: Equatable>: Equatable {
    let window: Node
    let debugArea: Node
    let focusedTextArea: Node
}

// A candidate only: focus within Debug Area does not establish LLDB input semantics.
// No node number, label, raw value or title is used or persisted.
func locateMemoryAXConsole<R: MemoryAXContextReader>(
    reader: R, documentURL: URL, deadline: TimeInterval,
    now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    cancelled: () -> Bool
) throws -> MemoryAXConsoleCandidate<R.Node> {
    func check() throws {
        if cancelled() { throw MemoryAXContextFailure.cancelled }
        guard deadline.isFinite, now() < deadline else { throw MemoryAXContextFailure.deadline }
        guard reader.ownerIsCurrent() else { throw MemoryAXContextFailure.changed }
        if cancelled() { throw MemoryAXContextFailure.cancelled }
        guard now() < deadline else { throw MemoryAXContextFailure.deadline }
    }
    func read<T>(_ node: R.Node, _ operation: () throws -> T) throws -> T {
        try check()
        try reader.setTimeout(node, Float(min(0.5, max(0.001, deadline - now()))))
        try check()
        let result = try operation()
        try check()
        return result
    }
    try check()
    guard let documentBinding = try? MemoryLocalDocumentBinding(expectedURL: documentURL) else {
        throw MemoryAXContextFailure.unavailable
    }
    try check()
    let windows = try read(reader.application) { try reader.windows() }
    guard windows.count == 1, let window = windows.first else { throw MemoryAXContextFailure.ambiguous }
    let windowRole = try read(window) { try reader.role(window) }
    let windowID = try read(window) { try reader.identifier(window) }
    guard windowRole == kAXWindowRole, windowID == "Xcode.WorkspaceWindow" else {
        throw MemoryAXContextFailure.unavailable
    }
    func checkDocument() throws {
        let raw = try read(window) { try reader.document(window) }
        guard documentBinding.matches(raw) else { throw MemoryAXContextFailure.changed }
    }
    try checkDocument()
    let focus = try read(reader.application) { try reader.focus() }
    var pending: [(R.Node, Int, R.Node?)] = [(window, 0, nil)]
    var visited: [R.Node] = []
    var debugAreas: [R.Node] = []
    var selectedArea: R.Node?
    while let (node, depth, inheritedArea) = pending.popLast() {
        try check()
        guard depth <= 16, visited.count < 512, !visited.contains(node) else {
            throw MemoryAXContextFailure.limit
        }
        visited.append(node)
        let role = try read(node) { try reader.role(node) }
        guard role != kAXSheetRole, role != "AXDialog" else { throw MemoryAXContextFailure.ambiguous }
        let identifier = try read(node) { try reader.identifier(node) }
        guard role.utf8.count <= 128, (identifier?.utf8.count ?? 0) <= 256 else {
            throw MemoryAXContextFailure.limit
        }
        var area = inheritedArea
        if identifier == "debug area" {
            debugAreas.append(node)
            guard debugAreas.count == 1 else { throw MemoryAXContextFailure.ambiguous }
            area = node
        }
        if node == focus, role == kAXTextAreaRole { selectedArea = area }
        let children = try read(node) { try reader.children(node) }
        guard children.count <= 64, pending.count + children.count + visited.count <= 512 else {
            throw MemoryAXContextFailure.limit
        }
        pending.append(contentsOf: children.map { ($0, depth + 1, area) })
    }
    guard debugAreas.count == 1, let area = selectedArea else { throw MemoryAXContextFailure.unavailable }
    let currentWindows = try read(reader.application) { try reader.windows() }
    let currentFocus = try read(reader.application) { try reader.focus() }
    guard currentWindows == windows, currentFocus == focus else { throw MemoryAXContextFailure.changed }
    try checkDocument()
    try check()
    return MemoryAXConsoleCandidate(window: window, debugArea: area, focusedTextArea: focus)
}

func inspectLocatedMemoryAXCapabilities<R: MemoryAXContextReader>(
    reader: R, documentURL: URL, deadline: TimeInterval,
    now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    cancelled: () -> Bool,
    capabilityReader: (R.Node) -> MemoryAXCapabilityReader
) throws -> MemoryAXCapabilityResult {
    let selected = try locateMemoryAXConsole(reader: reader, documentURL: documentURL,
                                             deadline: deadline, now: now, cancelled: cancelled)
    return inspectMemoryAXCapabilities(reader: capabilityReader(selected.focusedTextArea),
        deadline: deadline, now: now, cancelled: cancelled, contextIsCurrent: {
            // Re-resolve the whole bounded context, including every visible window,
            // before and after metadata queries. No cached numeric UI IDs are reused.
            (try? locateMemoryAXConsole(reader: reader, documentURL: documentURL,
                                       deadline: deadline, now: now, cancelled: cancelled)) == selected
        })
}

// The caller must retain the application returned by its own launch callback after
// checking initial absence and acquiring the global lease. This reader never adopts
// or launches an app. Those launch/lease prerequisites remain a separate integration.
struct PublicMemoryAXContextReader: MemoryAXContextReader {
    let launchedApplication: NSRunningApplication
    let expectedBundleURL: URL
    let application: AXUIElement

    init(launchedApplication: NSRunningApplication, expectedBundleURL: URL) {
        self.launchedApplication = launchedApplication
        self.expectedBundleURL = expectedBundleURL.standardizedFileURL
        self.application = AXUIElementCreateApplication(launchedApplication.processIdentifier)
    }

    func ownerIsCurrent() -> Bool {
        // NSRunningApplication properties require a live main run loop; the eventual
        // session driver must yield between observations, never block it with polling.
        guard Thread.isMainThread, !launchedApplication.isTerminated,
              launchedApplication.isActive, launchedApplication.processIdentifier > 0,
              launchedApplication.bundleIdentifier == "com.apple.dt.Xcode",
              launchedApplication.bundleURL?.standardizedFileURL == expectedBundleURL else { return false }
        let instances = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dt.Xcode")
        return instances.count == 1 && instances[0].isEqual(launchedApplication)
    }

    func setTimeout(_ node: AXUIElement, _ seconds: Float) throws {
        guard AXUIElementSetMessagingTimeout(node, seconds) == .success else { throw MemoryAXContextFailure.queryFailed }
    }

    private func value(_ node: AXUIElement, _ attribute: String, optional: Bool = false) throws -> CFTypeRef? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(node, attribute as CFString, &value)
        if optional && (error == .attributeUnsupported || error == .noValue) { return nil }
        guard error == .success, value != nil else { throw MemoryAXContextFailure.queryFailed }
        return value
    }
    private func nodes(_ node: AXUIElement, _ attribute: String, optional: Bool = false) throws -> [AXUIElement] {
        var count: CFIndex = 0
        let error = AXUIElementGetAttributeValueCount(node, attribute as CFString, &count)
        if optional && (error == .attributeUnsupported || error == .noValue) { return [] }
        guard error == .success else { throw MemoryAXContextFailure.queryFailed }
        guard (0...64).contains(count) else { throw MemoryAXContextFailure.limit }
        if count == 0 { return [] }
        var raw: CFArray?
        guard AXUIElementCopyAttributeValues(node, attribute as CFString, 0, count, &raw) == .success,
              let values = raw as? [AnyObject], values.count == count else {
            throw MemoryAXContextFailure.queryFailed
        }
        var currentCount: CFIndex = 0
        guard AXUIElementGetAttributeValueCount(node, attribute as CFString, &currentCount) == .success,
              currentCount == count else {
            throw MemoryAXContextFailure.changed
        }
        guard values.count <= 64 else {
            throw MemoryAXContextFailure.limit
        }
        return try values.map {
            guard CFGetTypeID($0) == AXUIElementGetTypeID() else { throw MemoryAXContextFailure.queryFailed }
            return $0 as! AXUIElement
        }
    }
    func windows() throws -> [AXUIElement] { try nodes(application, kAXWindowsAttribute) }
    func focus() throws -> AXUIElement {
        guard let raw = try value(application, kAXFocusedUIElementAttribute),
              CFGetTypeID(raw) == AXUIElementGetTypeID() else { throw MemoryAXContextFailure.queryFailed }
        return raw as! AXUIElement
    }
    func role(_ node: AXUIElement) throws -> String {
        guard let role = try value(node, kAXRoleAttribute) as? String else { throw MemoryAXContextFailure.queryFailed }
        return role
    }
    func identifier(_ node: AXUIElement) throws -> String? {
        guard let raw = try value(node, kAXIdentifierAttribute, optional: true) else { return nil }
        guard let identifier = raw as? String else { throw MemoryAXContextFailure.queryFailed }
        return identifier
    }
    func document(_ node: AXUIElement) throws -> String {
        guard let document = try value(node, kAXDocumentAttribute) as? String else { throw MemoryAXContextFailure.queryFailed }
        return document
    }
    func children(_ node: AXUIElement) throws -> [AXUIElement] { try nodes(node, kAXChildrenAttribute, optional: true) }
}
