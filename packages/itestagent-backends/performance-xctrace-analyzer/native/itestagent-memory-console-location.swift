import ApplicationServices
import Foundation

protocol MemoryAXConsoleLocationReader: MemoryAXContextReader {
    func consoleDescription(_ node: Node) throws -> String?
    func characterCount(_ node: Node) throws -> Int
    func text(_ node: Node, in range: CFRange) throws -> String
}

struct MemoryAXConsolePair<Node: Equatable>: Equatable {
    let context: MemoryAXConsoleCandidate<Node>
    let output: Node
}

// An explicit English Xcode console metadata candidate. Unknown/localized labels
// fail closed; no sibling order, coordinates, displayed text or numeric AX IDs are guessed.
func locateMemoryAXConsolePair<R: MemoryAXConsoleLocationReader>(
    reader: R, documentURL: URL, deadline: TimeInterval,
    now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    cancelled: () -> Bool
) throws -> MemoryAXConsolePair<R.Node> {
    func check() throws {
        if cancelled() { throw MemoryAXContextFailure.cancelled }
        guard deadline.isFinite, now() < deadline else { throw MemoryAXContextFailure.deadline }
        guard reader.ownerIsCurrent() else { throw MemoryAXContextFailure.changed }
        if cancelled() { throw MemoryAXContextFailure.cancelled }
        guard now() < deadline else { throw MemoryAXContextFailure.deadline }
    }
    func read<T>(_ node: R.Node, _ work: () throws -> T) throws -> T {
        try check()
        try reader.setTimeout(node, Float(min(0.5, max(0.001, deadline - now()))))
        try check()
        let value = try work()
        try check()
        return value
    }
    func context() throws -> MemoryAXConsoleCandidate<R.Node> {
        try locateMemoryAXConsole(reader: reader, documentURL: documentURL, deadline: deadline,
                                   now: now, cancelled: cancelled)
    }
    let initial = try context()
    func scan() throws -> R.Node {
        var pending: [(R.Node, Int)] = [(initial.debugArea, 0)]
        var visited: [R.Node] = []
        var inputs: [R.Node] = []
        var outputs: [R.Node] = []
        while let (node, depth) = pending.popLast() {
            try check()
            guard depth <= 16, visited.count < 512, !visited.contains(node) else {
                throw MemoryAXContextFailure.limit
            }
            visited.append(node)
            let role = try read(node) { try reader.role(node) }
            guard role != kAXSheetRole, role != "AXDialog" else { throw MemoryAXContextFailure.ambiguous }
            if role == kAXTextAreaRole {
                let description = try read(node) { try reader.consoleDescription(node) }
                guard (description?.utf8.count ?? 0) <= 128 else { throw MemoryAXContextFailure.limit }
                if description == "debug console" { inputs.append(node) }
                if description == "Console" { outputs.append(node) }
            }
            let children = try read(node) { try reader.children(node) }
            guard children.count <= 64, pending.count + children.count + visited.count <= 512 else {
                throw MemoryAXContextFailure.limit
            }
            pending.append(contentsOf: children.map { ($0, depth + 1) })
        }
        guard inputs.count <= 1, outputs.count <= 1 else { throw MemoryAXContextFailure.ambiguous }
        guard inputs.first == initial.focusedTextArea, let output = outputs.first,
              output != initial.focusedTextArea else { throw MemoryAXContextFailure.unavailable }
        return output
    }
    let output = try scan()
    let count = try read(output) { try reader.characterCount(output) }
    guard count >= 0, count <= Int(Int32.max) else { throw MemoryAXContextFailure.limit }
    // Probe the exact parameterized API, even for an empty output. A writable value
    // or a character count alone does not prove range reading works.
    let length = count == 0 ? 0 : 1
    let tail = try read(output) { try reader.text(output, in: CFRange(location: count - length, length: length)) }
    guard tail.utf16.count == length else { throw MemoryAXContextFailure.changed }
    let after = try read(output) { try reader.characterCount(output) }
    guard after >= count, after <= Int(Int32.max) else { throw MemoryAXContextFailure.changed }
    guard try context() == initial, try scan() == output else { throw MemoryAXContextFailure.changed }
    try check()
    return MemoryAXConsolePair(context: initial, output: output)
}

extension PublicMemoryAXContextReader: MemoryAXConsoleLocationReader {
    func consoleDescription(_ node: AXUIElement) throws -> String? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(node, kAXDescriptionAttribute as CFString, &value)
        if error == .attributeUnsupported || error == .noValue { return nil }
        guard error == .success, let value, CFGetTypeID(value) == CFStringGetTypeID() else {
            throw MemoryAXContextFailure.queryFailed
        }
        let string = value as! CFString
        guard CFStringGetLength(string) <= 128 else { throw MemoryAXContextFailure.limit }
        return string as String
    }

    func characterCount(_ node: AXUIElement) throws -> Int {
        try PublicMemoryConsoleResponseReader(element: node).characterCount()
    }

    func text(_ node: AXUIElement, in range: CFRange) throws -> String {
        try PublicMemoryConsoleResponseReader(element: node).text(in: range)
    }
}

// The caller already owns the launch/lease and must establish input submission
// semantics separately. Polling re-resolves the same pair rather than trusting a cached node.
func prepareLocatedMemoryResponseReceiver(
    reader: PublicMemoryAXContextReader, documentURL: URL,
    query: PreparedMemoryIdentityQuery, deadline: TimeInterval,
    now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    cancelled: @escaping () -> Bool
) throws -> MemoryConsoleResponseReceiver<PublicMemoryConsoleResponseReader> {
    let pair = try locateMemoryAXConsolePair(reader: reader, documentURL: documentURL,
                                             deadline: deadline, now: now, cancelled: cancelled)
    return try MemoryConsoleResponseReceiver(reader: PublicMemoryConsoleResponseReader(element: pair.output),
        query: query, deadline: deadline, now: now, cancelled: cancelled, contextIsCurrent: {
            (try? locateMemoryAXConsolePair(reader: reader, documentURL: documentURL,
                                            deadline: deadline, now: now, cancelled: cancelled)) == pair
        })
}
