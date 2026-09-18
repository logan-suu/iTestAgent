import ApplicationServices
import Foundation

let fixtureDocumentURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    .appendingPathComponent("itestagent-pair.xcodeproj", isDirectory: true)

final class ConsoleLocationFixture: MemoryAXConsoleLocationReader {
    let application = 0
    var current = true
    var focused = 3
    var windowNodes = [1]
    var tree = [1: [2], 2: [3, 4]]
    var roles = [1: kAXWindowRole, 2: kAXGroupRole, 3: kAXTextAreaRole, 4: kAXTextAreaRole]
    var identifiers = [1: "Xcode.WorkspaceWindow", 2: "debug area"]
    var descriptions = [3: "debug console", 4: "Console"]
    var documentValue = String(fixtureDocumentURL.absoluteString.dropLast())
    var textValue = "ignored output\n"
    var failRange = false
    var badLength = false
    var afterRange: () -> Void = {}
    var rangeNodes: [Int] = []
    func ownerIsCurrent() -> Bool { current }
    func setTimeout(_ node: Int, _ seconds: Float) throws { precondition(seconds > 0 && seconds <= 0.5) }
    func windows() throws -> [Int] { windowNodes }
    func focus() throws -> Int { focused }
    func role(_ node: Int) throws -> String { roles[node] ?? kAXGroupRole }
    func identifier(_ node: Int) throws -> String? { identifiers[node] }
    func document(_ node: Int) throws -> String { documentValue }
    func children(_ node: Int) throws -> [Int] { tree[node] ?? [] }
    func consoleDescription(_ node: Int) throws -> String? { descriptions[node] }
    func characterCount(_ node: Int) throws -> Int {
        precondition(node == 4)
        return (textValue as NSString).length
    }
    func text(_ node: Int, in range: CFRange) throws -> String {
        rangeNodes.append(node)
        precondition(range.length <= 1 && node == 4)
        if failRange { throw MemoryConsoleResponseFailure.queryFailed }
        let value = (textValue as NSString).substring(with: NSRange(location: range.location, length: range.length))
        afterRange()
        return badLength ? "wrong" : value
    }
}

@main
struct ConsoleLocationTests {
    static func main() throws {
        try FileManager.default.createDirectory(at: fixtureDocumentURL, withIntermediateDirectories: true)
        let url = fixtureDocumentURL
        func locate(_ reader: ConsoleLocationFixture, now: () -> TimeInterval = { 1 },
                    cancelled: () -> Bool = { false }) throws -> MemoryAXConsolePair<Int> {
            try locateMemoryAXConsolePair(reader: reader, documentURL: url, deadline: 10,
                                           now: now, cancelled: cancelled)
        }
        func rejects(_ work: () throws -> Void) {
            do { try work(); fatalError("Unexpected pair") }
            catch is MemoryAXContextFailure {} catch is MemoryConsoleResponseFailure {}
            catch { fatalError("Unexpected failure") }
        }
        let valid = ConsoleLocationFixture()
        let pair = try locate(valid)
        precondition(pair.output == 4 && pair.context.focusedTextArea == 3)
        precondition(valid.rangeNodes == [4])
        let reordered = ConsoleLocationFixture(); reordered.tree[2] = [4, 3]
        precondition(tryPair(reordered, url) == pair)
        let empty = ConsoleLocationFixture(); empty.textValue = ""
        precondition(tryPair(empty, url).output == 4)
        let focusedOutput = ConsoleLocationFixture(); focusedOutput.focused = 4
        rejects { _ = try locate(focusedOutput) }
        let unknown = ConsoleLocationFixture(); unknown.descriptions[4] = "Other"
        rejects { _ = try locate(unknown) }
        let localized = ConsoleLocationFixture(); localized.descriptions[3] = "输入"
        rejects { _ = try locate(localized) }
        let missing = ConsoleLocationFixture(); missing.descriptions[4] = nil
        rejects { _ = try locate(missing) }
        let duplicate = ConsoleLocationFixture()
        duplicate.tree[2] = [3, 4, 5]; duplicate.roles[5] = kAXTextAreaRole; duplicate.descriptions[5] = "Console"
        rejects { _ = try locate(duplicate) }
        let outside = ConsoleLocationFixture(); outside.tree = [1: [2, 4], 2: [3]]
        rejects { _ = try locate(outside) }
        let unsupported = ConsoleLocationFixture(); unsupported.failRange = true
        rejects { _ = try locate(unsupported) }
        let inconsistent = ConsoleLocationFixture(); inconsistent.badLength = true
        rejects { _ = try locate(inconsistent) }
        let document = ConsoleLocationFixture()
        document.afterRange = { document.documentValue = "file:///private/tmp/other.xcodeproj" }
        rejects { _ = try locate(document) }
        let focus = ConsoleLocationFixture(); focus.afterRange = { focus.focused = 4 }
        rejects { _ = try locate(focus) }
        let relabelled = ConsoleLocationFixture(); relabelled.afterRange = { relabelled.descriptions[4] = "Other" }
        rejects { _ = try locate(relabelled) }
        let replaced = ConsoleLocationFixture()
        replaced.afterRange = {
            replaced.tree[2] = [3, 5]; replaced.roles[5] = kAXTextAreaRole; replaced.descriptions[5] = "Console"
        }
        rejects { _ = try locate(replaced) }
        let owner = ConsoleLocationFixture(); owner.afterRange = { owner.current = false }
        rejects { _ = try locate(owner) }
        var cancelled = false
        let cancellation = ConsoleLocationFixture(); cancellation.afterRange = { cancelled = true }
        rejects { _ = try locate(cancellation, cancelled: { cancelled }) }
        var clock: TimeInterval = 1
        let timeout = ConsoleLocationFixture(); timeout.afterRange = { clock = 10 }
        rejects { _ = try locate(timeout, now: { clock }) }
        let lateSheet = ConsoleLocationFixture()
        lateSheet.afterRange = { lateSheet.tree[1] = [2, 5]; lateSheet.roles[5] = kAXSheetRole }
        rejects { _ = try locate(lateSheet) }
        let oversized = ConsoleLocationFixture(); oversized.descriptions[4] = String(repeating: "x", count: 129)
        rejects { _ = try locate(oversized) }
        print("{\"uniquePair\":true,\"rangeChecked\":true,\"driftBlocked\":true,\"cancelAndDeadline\":true,\"candidateOnly\":true}")
    }
    static func tryPair(_ reader: ConsoleLocationFixture, _ url: URL) -> MemoryAXConsolePair<Int> {
        try! locateMemoryAXConsolePair(reader: reader, documentURL: url, deadline: 10,
                                       now: { 1 }, cancelled: { false })
    }
}
