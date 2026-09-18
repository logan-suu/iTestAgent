import ApplicationServices
import Foundation

final class SubmissionFixture: MemoryConsoleSubmissionAdapter {
    var input = "(lldb) "
    var caret = 7
    var selectedLength = 0
    var writable = true
    var advertised = [kAXConfirmAction]
    var writes = 0
    var confirms = 0
    var failInsert = false
    var failConfirm = false
    var alterInsert = false
    var afterWrite: () -> Void = {}
    var afterConfirm: () -> Void = {}
    func setTimeout(_ seconds: Float) throws { precondition(seconds > 0 && seconds <= 0.5) }
    func characterCount() throws -> Int { input.utf16.count }
    func text(in range: CFRange) throws -> String {
        precondition(range.length <= 1031)
        return (input as NSString).substring(with: NSRange(location: range.location, length: range.length))
    }
    func selection() throws -> CFRange { CFRange(location: caret, length: selectedLength) }
    func selectedTextIsSettable() throws -> Bool { writable }
    func actions() throws -> [String] { advertised }
    func insertSelectedText(_ command: String) throws {
        writes += 1
        input += alterInsert ? "wrong" : command
        caret = input.utf16.count
        afterWrite()
        if failInsert { throw MemoryConsoleSubmissionFailure.insertionFailed }
    }
    func confirm() throws {
        confirms += 1
        afterConfirm()
        if failConfirm { throw MemoryConsoleSubmissionFailure.confirmationFailed }
    }
}

final class ExchangeOutput: MemoryConsoleResponseReader {
    var value = "history\n"
    func setTimeout(_ seconds: Float) throws {}
    func characterCount() throws -> Int { value.utf16.count }
    func text(in range: CFRange) throws -> String {
        (value as NSString).substring(with: NSRange(location: range.location, length: range.length))
    }
}

@main
struct SubmissionTests {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let resources = root.appendingPathComponent("Submit.app/Contents/Resources")
        let fm = FileManager.default
        try fm.createDirectory(at: resources, withIntermediateDirectories: true)
        let info = ["CFBundleIdentifier": "dev.itestagent.submit-fixture", "CFBundlePackageType": "APPL",
                    "CFBundleExecutable": "fixture"]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: root.appendingPathComponent("Submit.app/Contents/Info.plist"))
        let file = resources.appendingPathComponent("itestagent_memory_identity.py")
        try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])).write(to: file)
        let query = try PreparedMemoryIdentityQuery.prepare(in: Bundle(url: root.appendingPathComponent("Submit.app"))!,
            requestID: "b4044ac9-c18b-42cb-a8bd-3093c5045404", deadline: 10,
            now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
        func submission(_ fixture: SubmissionFixture, now: @escaping () -> TimeInterval = { 1 },
                        cancelled: @escaping () -> Bool = { false }, context: @escaping () -> Bool = { true })
                        -> MemoryConsoleSubmission<SubmissionFixture> {
            MemoryConsoleSubmission(adapter: fixture, query: query, deadline: 10,
                                    now: now, cancelled: cancelled, contextIsCurrent: context)
        }
        func rejects(_ expected: MemoryConsoleSubmissionFailure? = nil, _ work: () throws -> Void) {
            do { try work(); fatalError("Expected failure") }
            catch let error as MemoryConsoleSubmissionFailure { if let expected { precondition(error == expected) } }
            catch is MemoryIdentityScriptFailure { precondition(expected == nil) }
            catch { fatalError("Unexpected error") }
        }
        let valid = SubmissionFixture(); let good = submission(valid)
        try good.submitOnce()
        precondition(valid.writes == 1 && valid.confirms == 1 && good.confirmationAttempted)
        rejects(.consumed) { try good.submitOnce() }
        for mode in 0...4 {
            let f = SubmissionFixture()
            if mode == 0 { f.advertised = [] }
            if mode == 1 { f.advertised = [kAXPressAction] }
            if mode == 2 { f.writable = false }
            if mode == 3 { f.input += "user text" }
            if mode == 4 { f.selectedLength = 1 }
            let s = submission(f)
            rejects { try s.submitOnce() }
            rejects(.consumed) { try s.submitOnce() }
            precondition(f.writes == 0 && f.confirms == 0)
        }
        let inserted = SubmissionFixture(); inserted.alterInsert = true
        rejects(.inputChanged) { try submission(inserted).submitOnce() }
        precondition(inserted.writes == 1 && inserted.confirms == 0)
        let writeFailed = SubmissionFixture(); writeFailed.failInsert = true
        let failedWrite = submission(writeFailed)
        rejects(.insertionFailed) { try failedWrite.submitOnce() }
        precondition(failedWrite.insertionAttempted && !failedWrite.confirmationAttempted)
        rejects(.consumed) { try failedWrite.submitOnce() }
        let confirmFailed = SubmissionFixture(); confirmFailed.failConfirm = true
        let failedConfirm = submission(confirmFailed)
        rejects(.confirmationFailed) { try failedConfirm.submitOnce() }
        precondition(failedConfirm.confirmationAttempted && confirmFailed.confirms == 1)
        rejects(.consumed) { try failedConfirm.submitOnce() }
        var cancelled = false
        let cancellation = SubmissionFixture(); cancellation.afterWrite = { cancelled = true }
        rejects(.cancelled) { try submission(cancellation, cancelled: { cancelled }).submitOnce() }
        precondition(cancellation.confirms == 0)
        var current = true
        let drift = SubmissionFixture(); drift.afterWrite = { current = false }
        rejects(.contextChanged) { try submission(drift, context: { current }).submitOnce() }
        precondition(drift.confirms == 0)
        var clock: TimeInterval = 1
        let timeout = SubmissionFixture(); timeout.afterWrite = { clock = 10 }
        rejects(.deadline) { try submission(timeout, now: { clock }).submitOnce() }
        precondition(timeout.confirms == 0)
        let lostAction = SubmissionFixture(); lostAction.afterWrite = { lostAction.advertised = [] }
        rejects(.unsupported) { try submission(lostAction).submitOnce() }
        precondition(lostAction.confirms == 0)
        let output = ExchangeOutput()
        let exchangeAdapter = SubmissionFixture()
        let response = "ITESTAGENT_MEMORY_IDENTITY {\"protocolVersion\":1,\"requestId\":\"\(query.requestID)\",\"status\":\"unverifiable\"}\n"
        exchangeAdapter.afterConfirm = { output.value += response }
        let exchange = try MemoryConsoleQueryExchange(adapter: exchangeAdapter, output: output,
            query: query, deadline: 10, now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
        rejects(.consumed) { _ = try exchange.poll() }
        try exchange.submitOnce()
        let candidate = try exchange.poll()
        precondition(candidate?.line == String(response.dropLast()))
        rejects(.consumed) { try exchange.submitOnce() }
        rejects(.consumed) { _ = try exchange.poll() }
        let failedAdapter = SubmissionFixture(); failedAdapter.failConfirm = true
        let failedExchange = try MemoryConsoleQueryExchange(adapter: failedAdapter, output: ExchangeOutput(),
            query: query, deadline: 10, now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
        rejects(.confirmationFailed) { try failedExchange.submitOnce() }
        rejects(.consumed) { _ = try failedExchange.poll() }
        let sourceChanged = SubmissionFixture()
        sourceChanged.afterWrite = { try! Data("changed".utf8).write(to: file) }
        rejects { try submission(sourceChanged).submitOnce() }
        precondition(sourceChanged.confirms == 0)
        print("{\"fixedQueryOnly\":true,\"oneAttempt\":true,\"unsupportedBeforeWrite\":true,\"driftAfterWrite\":true,\"ambiguousFailureConsumed\":true}")
    }
}
