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


final class ReturnTransportFixture: MemoryConsoleReturnTransport {
    var ax = true; var events = true; var owner = true
    var downs = 0; var ups = 0
    var failDown = false; var failUp = false
    var afterDown: () -> Void = {}; var afterUp: () -> Void = {}
    func permissionsAvailable() -> Bool { ax && events }
    func originalInstanceIsCurrent() -> Bool { owner }
    func postReturnDown() throws {
        downs += 1; afterDown()
        if failDown { throw MemoryConsoleReturnFailure.eventUnavailable }
    }
    func postReturnUp() throws {
        ups += 1; afterUp()
        if failUp { throw MemoryConsoleReturnFailure.eventUnavailable }
    }
}
@main struct ReturnTests {
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

        // Every adapter is synthetic; the public CGEvent adapter is never constructed.
        for mode in 0..<24 {
            let input = SubmissionFixture(); input.advertised = []
            let output = ExchangeOutput(); let transport = ReturnTransportFixture()
            var cancel = false; var time: TimeInterval = 1; var context = true
            let exchange = try MemoryConsoleReturnExchange(adapter: input, output: output,
                transport: transport, query: query, deadline: 10, now: { time },
                cancelled: { cancel }, contextIsCurrent: { context })
            if mode == 1 { transport.ax = false }
            if mode == 2 { transport.events = false }
            if mode == 3 { transport.owner = false }
            if mode == 4 { context = false }
            if mode == 5 { input.input += "existing" }
            if mode == 6 { input.selectedLength = 1 }
            if mode == 7 { input.writable = false }
            if mode == 8 { input.alterInsert = true }
            if mode == 9 { input.failInsert = true }
            if mode == 10 { input.afterWrite = { cancel = true } }
            if mode == 11 { input.afterWrite = { time = 10 } }
            if mode == 12 { input.afterWrite = { context = false } }
            if mode == 13 { transport.afterDown = { cancel = true } }
            if mode == 14 { transport.afterDown = { time = 10 } }
            if mode == 15 { transport.afterDown = { transport.owner = false } }
            if mode == 16 { transport.failDown = true }
            if mode == 17 { transport.failUp = true }
            if mode == 18 { transport.afterUp = { cancel = true } }
            if mode == 19 { cancel = true }
            if mode == 20 { time = 10 }
            if mode == 21 { input.afterWrite = { transport.events = false } }
            if mode == 22 { transport.afterDown = { context = false } }
            if mode == 23 { transport.afterUp = { time = 10 } }
            var failed = false
            do { try exchange.submitOnce() } catch { failed = true }
            precondition(failed == (mode != 0))
            let beforeWrite = (1...7).contains(mode) || mode == 19 || mode == 20
            precondition(input.writes == (beforeWrite ? 0 : 1))
            let sent = mode == 0 || (13...18).contains(mode) || mode >= 22
            precondition(transport.downs == (sent ? 1 : 0))
            precondition(transport.ups == (sent && mode != 15 ? 1 : 0))
            precondition(exchange.downAttempted == sent && input.confirms == 0)
            precondition(!exchange.releaseDeliveryVerified)
            do { try exchange.submitOnce(); fatalError("Retry accepted") } catch {}
            if mode == 0 {
                let absent = try exchange.poll(); precondition(absent == nil)
                cancel = true
                do { _ = try exchange.poll(); fatalError("Cancelled poll accepted") } catch {}
            }
            do { _ = try exchange.poll(); fatalError("Closed poll accepted") } catch {}
        }
        // Capture baseline before insertion; absent response cannot imply execution.
        let input = SubmissionFixture(); let output = ExchangeOutput(); let transport = ReturnTransportFixture()
        let exchange = try MemoryConsoleReturnExchange(adapter: input, output: output,
            transport: transport, query: query, deadline: 10, now: { 1 },
            cancelled: { false }, contextIsCurrent: { true })
        input.afterWrite = { output.value = "" }
        try exchange.submitOnce()
        do { _ = try exchange.poll(); fatalError("Shrunk output accepted") } catch {}
        let response = "ITESTAGENT_MEMORY_IDENTITY {\"protocolVersion\":1,\"requestId\":\"\(query.requestID)\",\"status\":\"unverifiable\"}\n"
        for copies in 0...2 {
            let f = SubmissionFixture(); let o = ExchangeOutput(); let t = ReturnTransportFixture()
            let e = try MemoryConsoleReturnExchange(adapter: f, output: o, transport: t,
                query: query, deadline: 10, now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
            t.afterDown = {
                o.value += "echo\nITESTAGENT_MEMORY_IDENTITY {\"requestId\":\"old\"}\n"
                o.value += String(repeating: response, count: copies)
            }
            try e.submitOnce()
            if copies == 2 {
                do { _ = try e.poll(); fatalError("Duplicate accepted") } catch {}
            } else {
                let candidate = try e.poll()
                precondition(candidate?.line == (copies == 1 ? String(response.dropLast()) : nil))
            }
            do { try e.submitOnce(); fatalError("Resubmission accepted") } catch {}
            precondition(t.downs == 1 && t.ups == 1)
        }
        // Source changes after preparation, before or after insertion, fail closed.
        let original = try Data(contentsOf: file)
        for after in [false, true] {
            try original.write(to: file)
            let fresh = try PreparedMemoryIdentityQuery.prepare(in: Bundle(url: root.appendingPathComponent("Submit.app"))!,
                requestID: "b4044ac9-c18b-42cb-a8bd-3093c5045404", deadline: 10,
                now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
            let f = SubmissionFixture(); let t = ReturnTransportFixture()
            let e = try MemoryConsoleReturnExchange(adapter: f, output: ExchangeOutput(), transport: t,
                query: fresh, deadline: 10, now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
            let mutate = { try! Data("changed".utf8).write(to: file) }
            if after { f.afterWrite = mutate } else { mutate() }
            do { try e.submitOnce(); fatalError("Source drift accepted") } catch {}
            precondition(f.writes == (after ? 1 : 0) && t.downs == 0 && t.ups == 0)
        }
        print("{\"syntheticOnly\":true,\"onePairMaximum\":true,\"cancellationCleanup\":true,\"noDeliveryClaim\":true}")
    }
}
