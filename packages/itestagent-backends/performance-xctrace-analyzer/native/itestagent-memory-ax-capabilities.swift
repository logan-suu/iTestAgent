import ApplicationServices
import Foundation

// Metadata only. This interface deliberately has no value-read or mutation methods.
protocol MemoryAXCapabilityReader {
    func setTimeout(_ seconds: Float) throws
    func role() throws -> String
    func valueIsSettable() throws -> Bool
    func actions() throws -> [String]
}

enum MemoryAXCapabilityFailure: String, Error, Codable {
    case queryFailed = "accessibility_query_failed"
    case invalidMetadata = "accessibility_metadata_invalid"
    case contextChanged = "context_changed"
    case cancelled
    case deadlineExceeded = "deadline_exceeded"
}

struct MemoryAXCapabilities: Encodable, Equatable {
    let textArea: Bool
    let valueSettable: Bool
    let confirmAdvertised: Bool
    let pressAdvertised: Bool
    let otherActionCount: Int
    // An advertised action does not prove console identity or submission semantics.
    let submissionVerified = false
}

struct MemoryAXCapabilityResult: Encodable {
    let capabilities: MemoryAXCapabilities?
    let failure: MemoryAXCapabilityFailure?
}

// The session owner must supply a freshly selected element and revalidate ownership,
// element selection and window continuity. A PID comparison alone is insufficient.
func inspectMemoryAXCapabilities(
    reader: MemoryAXCapabilityReader,
    deadline: TimeInterval,
    now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    cancelled: () -> Bool,
    contextIsCurrent: () -> Bool
) -> MemoryAXCapabilityResult {
    func check() throws {
        if cancelled() { throw MemoryAXCapabilityFailure.cancelled }
        guard deadline.isFinite, now() < deadline else {
            throw MemoryAXCapabilityFailure.deadlineExceeded
        }
        guard contextIsCurrent() else { throw MemoryAXCapabilityFailure.contextChanged }
        // Recheck after a potentially blocking owner validation.
        if cancelled() { throw MemoryAXCapabilityFailure.cancelled }
        guard now() < deadline else { throw MemoryAXCapabilityFailure.deadlineExceeded }
    }
    func read<T>(_ operation: () throws -> T) throws -> T {
        try check()
        try reader.setTimeout(Float(min(0.5, max(0.001, deadline - now()))))
        try check()
        let result = try operation()
        try check()
        return result
    }
    do {
        let role = try read { try reader.role() }
        guard role.utf8.count <= 128 else { throw MemoryAXCapabilityFailure.invalidMetadata }
        let settable = try read { try reader.valueIsSettable() }
        let actions = try read { try reader.actions() }
        guard actions.count <= 64,
              actions.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 }),
              Set(actions).count == actions.count else {
            throw MemoryAXCapabilityFailure.invalidMetadata
        }
        let confirm = actions.contains(kAXConfirmAction)
        let press = actions.contains(kAXPressAction)
        return MemoryAXCapabilityResult(capabilities: MemoryAXCapabilities(
            textArea: role == kAXTextAreaRole,
            valueSettable: settable,
            confirmAdvertised: confirm,
            pressAdvertised: press,
            otherActionCount: actions.count - (confirm ? 1 : 0) - (press ? 1 : 0)
        ), failure: nil)
    } catch {
        return MemoryAXCapabilityResult(
            capabilities: nil,
            failure: error as? MemoryAXCapabilityFailure ?? .queryFailed
        )
    }
}

// Uses only public APIs. No trust prompt, tree traversal, attribute values beyond
// role, action execution, keyboard events, console text or device identifiers.
struct PublicMemoryAXCapabilityReader: MemoryAXCapabilityReader {
    let element: AXUIElement

    func setTimeout(_ seconds: Float) throws {
        guard AXUIElementSetMessagingTimeout(element, seconds) == .success else {
            throw MemoryAXCapabilityFailure.queryFailed
        }
    }

    func role() throws -> String {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value) == .success,
              let role = value as? String else { throw MemoryAXCapabilityFailure.queryFailed }
        return role
    }

    func valueIsSettable() throws -> Bool {
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success else {
            throw MemoryAXCapabilityFailure.queryFailed
        }
        return settable.boolValue
    }

    func actions() throws -> [String] {
        var value: CFArray?
        guard AXUIElementCopyActionNames(element, &value) == .success,
              let array = value, CFArrayGetCount(array) <= 64,
              let names = array as? [String] else { throw MemoryAXCapabilityFailure.queryFailed }
        return names
    }
}
