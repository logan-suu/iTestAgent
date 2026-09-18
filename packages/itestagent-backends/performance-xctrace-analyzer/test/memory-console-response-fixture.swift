import ApplicationServices
import Foundation

final class ResponseReader: MemoryConsoleResponseReader {
    var transcript = "history\n"
    var ranges: [CFRange] = []
    var afterRead: () -> Void = {}
    func setTimeout(_ seconds: Float) throws { precondition(seconds > 0 && seconds <= 0.5) }
    func characterCount() throws -> Int { (transcript as NSString).length }
    func text(in range: CFRange) throws -> String {
        ranges.append(range)
        let value = (transcript as NSString).substring(with: NSRange(location: range.location, length: range.length))
        afterRead()
        return value
    }
}

@main
struct ConsoleResponseTests {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let fm = FileManager.default
        let app = root.appendingPathComponent("Receiver.app")
        let resources = app.appendingPathComponent("Contents/Resources")
        try fm.createDirectory(at: resources, withIntermediateDirectories: true)
        let info = ["CFBundleIdentifier": "dev.itestagent.receiver", "CFBundlePackageType": "APPL",
                    "CFBundleExecutable": "fixture"]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: app.appendingPathComponent("Contents/Info.plist"))
        let source = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        let file = resources.appendingPathComponent("itestagent_memory_identity.py")
        try source.write(to: file)
        guard let bundle = Bundle(url: app) else { fatalError("Invalid fixture bundle") }
        let request = "b4044ac9-c18b-42cb-a8bd-3093c5045404"
        let query = try PreparedMemoryIdentityQuery.prepare(in: bundle, requestID: request, deadline: 10,
                                                            now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
        let line = "ITESTAGENT_MEMORY_IDENTITY {\"protocolVersion\":1,\"requestId\":\"\(request)\",\"status\":\"observed\",\"debuggerId\":0,\"processInstance\":1,\"pid\":123,\"moduleUUID\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"triple\":\"fixture\",\"platform\":\"fixture\",\"executable\":\"/fixture\"}"
        func receiver(_ reader: ResponseReader, now: @escaping () -> TimeInterval = { 1 },
                      cancelled: @escaping () -> Bool = { false },
                      context: @escaping () -> Bool = { true }) throws -> MemoryConsoleResponseReceiver<ResponseReader> {
            try MemoryConsoleResponseReceiver(reader: reader, query: query, deadline: 10,
                                               now: now, cancelled: cancelled, contextIsCurrent: context)
        }
        func rejects(_ expected: MemoryConsoleResponseFailure? = nil, _ work: () throws -> Void) {
            do { try work(); fatalError("Expected rejection") }
            catch let error as MemoryConsoleResponseFailure {
                if let expected { precondition(error == expected) }
            } catch is MemoryIdentityScriptFailure {
                precondition(expected == nil)
            } catch { fatalError("Unexpected error type") }
        }
        func pending(_ receiver: MemoryConsoleResponseReceiver<ResponseReader>) throws {
            let value = try receiver.poll()
            precondition(value == nil)
        }
        let split = ResponseReader()
        let successful = try receiver(split)
        try pending(successful)
        split.transcript += "(lldb) script echo\n🧪 ignored\n" + String(line.prefix(25))
        try pending(successful)
        split.transcript += String(line.dropFirst(25)) + "\r\n"
        let candidate = try successful.poll()
        precondition(candidate?.line == line)
        rejects(.closed) { _ = try successful.poll() }
        precondition(split.ranges.allSatisfy { $0.length <= 16384 })
        let old = ResponseReader()
        old.transcript += line + "\n"
        let oldReceiver = try receiver(old)
        try pending(oldReceiver)
        old.transcript += line.replacingOccurrences(of: request, with: "00000000-0000-0000-0000-000000000000") + "\n"
        try pending(oldReceiver)
        let partial = ResponseReader()
        partial.transcript = "old partial"
        let partialReceiver = try receiver(partial)
        partial.transcript += line + "\n"
        try pending(partialReceiver)
        let duplicate = ResponseReader()
        let duplicateReceiver = try receiver(duplicate)
        duplicate.transcript += line + "\n" + line + "\n"
        rejects(.ambiguous) { _ = try duplicateReceiver.poll() }
        rejects(.closed) { _ = try duplicateReceiver.poll() }
        let cleared = ResponseReader()
        let clearedReceiver = try receiver(cleared)
        cleared.transcript = ""
        rejects(.changed) { _ = try clearedReceiver.poll() }
        let huge = ResponseReader()
        let hugeReceiver = try receiver(huge)
        huge.transcript += String(repeating: "x", count: 16385)
        rejects(.limit) { _ = try hugeReceiver.poll() }
        precondition(huge.ranges.count == 1)
        let malformed = ResponseReader()
        let malformedReceiver = try receiver(malformed)
        malformed.transcript += "ITESTAGENT_MEMORY_IDENTITY nope\n"
        rejects(.invalidResponse) { _ = try malformedReceiver.poll() }
        var cancelled = false
        let cancellation = ResponseReader()
        let cancelledReceiver = try receiver(cancellation, cancelled: { cancelled })
        cancellation.transcript += line + "\n"
        cancellation.afterRead = { cancelled = true }
        rejects(.cancelled) { _ = try cancelledReceiver.poll() }
        var current = true
        let drift = ResponseReader()
        let driftReceiver = try receiver(drift, context: { current })
        drift.transcript += line + "\n"
        drift.afterRead = { current = false }
        rejects(.contextChanged) { _ = try driftReceiver.poll() }
        var clock: TimeInterval = 1
        let timeout = ResponseReader()
        let timeoutReceiver = try receiver(timeout, now: { clock })
        clock = 10
        rejects(.deadline) { _ = try timeoutReceiver.poll() }
        var cancelDuringContext = false
        var contextCancels = false
        let contextCancellation = ResponseReader()
        let contextCancellationReceiver = try receiver(contextCancellation,
            cancelled: { cancelDuringContext }, context: {
                if contextCancels { cancelDuringContext = true; return false }
                return true
            })
        contextCancels = true
        rejects(.cancelled) { _ = try contextCancellationReceiver.poll() }
        var contextClock: TimeInterval = 1
        var contextExpires = false
        let contextTimeoutReceiver = try receiver(ResponseReader(), now: { contextClock }, context: {
            if contextExpires { contextClock = 10; return false }
            return true
        })
        contextExpires = true
        rejects(.deadline) { _ = try contextTimeoutReceiver.poll() }
        let changed = ResponseReader()
        let changedReceiver = try receiver(changed)
        changed.transcript += line + "\n"
        changed.afterRead = { try! Data("changed".utf8).write(to: file) }
        rejects { _ = try changedReceiver.poll() }
        let native = PublicMemoryConsoleResponseReader(element: AXUIElementCreateApplication(999999))
        try native.setTimeout(0.01)
        rejects(.queryFailed) { _ = try native.characterCount() }
        let result: [String: Any] = ["candidate": candidate!.line, "requestID": request,
                                    "boundedReads": true, "partialAndStale": true, "duplicateBlocked": true,
                                    "cancelDriftAndSource": true, "nativeMissingElementBlocked": true]
        print(String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self))
    }
}
