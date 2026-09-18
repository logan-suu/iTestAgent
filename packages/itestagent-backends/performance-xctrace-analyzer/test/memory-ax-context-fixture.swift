import AppKit
import ApplicationServices
import Foundation

let fixtureDocumentURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    .appendingPathComponent("itestagent-fixture.xcodeproj", isDirectory: true)

final class ContextFixture: MemoryAXContextReader {
    let application = 0
    var current = true
    var windowNodes = [1]
    var focused = 3
    var roles = [1: kAXWindowRole, 2: kAXGroupRole, 3: kAXTextAreaRole, 4: kAXTextAreaRole]
    var identifiers = [1: "Xcode.WorkspaceWindow", 2: "debug area"]
    var tree = [1: [2], 2: [3, 4]]
    var documentValue = String(fixtureDocumentURL.absoluteString.dropLast())
    var reads = 0
    var afterRead: () -> Void = {}
    var failChildren = false
    func didRead() { reads += 1; afterRead() }
    func ownerIsCurrent() -> Bool { current }
    func setTimeout(_ node: Int, _ seconds: Float) throws { precondition(seconds > 0 && seconds <= 0.5) }
    func windows() throws -> [Int] { didRead(); return windowNodes }
    func focus() throws -> Int { didRead(); return focused }
    func role(_ node: Int) throws -> String { didRead(); return roles[node] ?? kAXGroupRole }
    func identifier(_ node: Int) throws -> String? { didRead(); return identifiers[node] }
    func document(_ node: Int) throws -> String { didRead(); return documentValue }
    func children(_ node: Int) throws -> [Int] {
        didRead()
        if failChildren { throw MemoryAXContextFailure.queryFailed }
        return tree[node] ?? []
    }
}

final class ContextCapabilityFixture: MemoryAXCapabilityReader {
    let context: ContextFixture
    var changed = false
    init(_ context: ContextFixture) { self.context = context }
    func setTimeout(_ seconds: Float) throws {}
    func role() throws -> String {
        if changed { context.focused = 4 }
        return kAXTextAreaRole
    }
    func valueIsSettable() throws -> Bool { true }
    func actions() throws -> [String] { [kAXConfirmAction] }
}

@main
struct ContextTests {
    static func main() throws {
        try FileManager.default.createDirectory(at: fixtureDocumentURL, withIntermediateDirectories: true)
        let url = fixtureDocumentURL
        func locate(_ fixture: ContextFixture) throws -> MemoryAXConsoleCandidate<Int> {
            try locateMemoryAXConsole(reader: fixture, documentURL: url, deadline: 10,
                                      now: { 1 }, cancelled: { false })
        }
        func rejects(_ fixture: ContextFixture, _ reason: MemoryAXContextFailure) {
            do { _ = try locate(fixture); preconditionFailure("Unexpected candidate") }
            catch { precondition((error as? MemoryAXContextFailure) == reason) }
        }
        let valid = ContextFixture()
        let candidate = try locate(valid)
        precondition(candidate == MemoryAXConsoleCandidate(window: 1, debugArea: 2, focusedTextArea: 3))
        let conflict = ContextFixture(); conflict.windowNodes.append(5)
        rejects(conflict, .ambiguous)
        let absent = ContextFixture(); absent.windowNodes = []
        rejects(absent, .ambiguous)
        let owner = ContextFixture(); owner.current = false
        rejects(owner, .changed); precondition(owner.reads == 0)
        let document = ContextFixture(); document.documentValue = "file:///private/tmp/other.xcodeproj"
        rejects(document, .changed)
        let wrongWindow = ContextFixture(); wrongWindow.identifiers[1] = "OtherWindow"
        rejects(wrongWindow, .unavailable)
        let duplicate = ContextFixture(); duplicate.identifiers[4] = "debug area"
        rejects(duplicate, .ambiguous)
        let sheet = ContextFixture(); sheet.roles[4] = kAXSheetRole
        rejects(sheet, .ambiguous)
        let unfocused = ContextFixture(); unfocused.focused = 1
        rejects(unfocused, .unavailable)
        let outside = ContextFixture(); outside.tree = [1: [2, 3], 2: [4]]
        rejects(outside, .unavailable)
        let cycle = ContextFixture(); cycle.tree[4] = [2]
        rejects(cycle, .limit)
        let many = ContextFixture(); many.tree[2] = Array(10...74)
        rejects(many, .limit)
        let deep = ContextFixture(); deep.tree[4] = [5]
        for node in 5...24 { deep.tree[node] = [node + 1] }
        rejects(deep, .limit)
        let error = ContextFixture(); error.failChildren = true
        rejects(error, .queryFailed)
        let changed = ContextFixture(); changed.afterRead = { if changed.reads == 8 { changed.current = false } }
        rejects(changed, .changed); precondition(changed.reads == 8)
        let stale = ContextFixture(); stale.afterRead = { if stale.reads == 8 { stale.focused = 4 } }
        rejects(stale, .changed)
        let cancelled = ContextFixture()
        do {
            _ = try locateMemoryAXConsole(reader: cancelled, documentURL: url, deadline: 10,
                now: { 1 }, cancelled: { cancelled.reads == 8 })
            preconditionFailure("Unexpected candidate")
        } catch { precondition((error as? MemoryAXContextFailure) == .cancelled) }
        precondition(cancelled.reads == 8)
        let late = ContextFixture()
        do {
            _ = try locateMemoryAXConsole(reader: late, documentURL: url, deadline: 10,
                now: { late.reads >= 8 ? 10 : 1 }, cancelled: { false })
            preconditionFailure("Unexpected candidate")
        } catch { precondition((error as? MemoryAXContextFailure) == .deadline) }
        precondition(late.reads == 8)

        let metadata = ContextFixture()
        let metadataReader = ContextCapabilityFixture(metadata)
        let observed = try inspectLocatedMemoryAXCapabilities(reader: metadata, documentURL: url,
            deadline: 10, now: { 1 }, cancelled: { false }, capabilityReader: { node in
                precondition(node == 3); return metadataReader
            })
        precondition(observed.capabilities?.confirmAdvertised == true)
        precondition(observed.capabilities?.submissionVerified == false)
        metadataReader.changed = true
        let discarded = try inspectLocatedMemoryAXCapabilities(reader: metadata, documentURL: url,
            deadline: 10, now: { 1 }, cancelled: { false }, capabilityReader: { _ in metadataReader })
        precondition(discarded.failure == .contextChanged && discarded.capabilities == nil)
        // The actual adapter rejects this fixture's own non-Xcode process before AX access.
        let native = PublicMemoryAXContextReader(launchedApplication: .current,
                                                 expectedBundleURL: URL(fileURLWithPath: "/private/tmp/not-xcode.app"))
        precondition(!native.ownerIsCurrent())
        print("{\"uniqueContext\":true,\"conflictsBlocked\":true,\"boundedTraversal\":true,\"cancelAndDrift\":true,\"capabilitiesBound\":true,\"foreignOwnerRejected\":true}")
    }
}
